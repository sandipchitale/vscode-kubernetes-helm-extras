'use strict';

import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
// import { ungzip } from 'node-gzip';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import * as zlib from 'zlib';
import * as YAML from 'json-to-pretty-yaml';

const HELMPREVIEW_SUFFIX = '.helmpreview';
const templatePreviewTextEditorCache = {};
const templatetHelmPreviewFileCache = {};

const MANIFEST = 'Manifest';
const TEMPLATES = 'Templates';
const VALUES = 'Values';
const NOTES = 'Notes';
const HOOKS = 'Hooks';
const CHART = 'Chart';
const INFO = 'Info';
const RAW = 'Raw';

const GET_TYPES = [
    MANIFEST,
    TEMPLATES,
    VALUES,
    NOTES,
    HOOKS,
    CHART,
    INFO,
    RAW
]

export async function activate(context: vscode.ExtensionContext) {
    const explorer = await k8s.extension.clusterExplorer.v1;
    if (!explorer.available) {
        vscode.window.showErrorMessage(`ClusterExplorer not available.`);
        return;
    }

    const helm = await k8s.extension.helm.v1;
    if (!helm.available) {
        vscode.window.showErrorMessage(`helm not available.`);
        return;
    }

    let disposable: vscode.Disposable;

    disposable = vscode.commands.registerTextEditorCommand('k8s.helm.helmTemplatePreview.custom', helmTemplatePreview);
    context.subscriptions.push(disposable);

    // Helm get
    disposable = vscode.commands.registerCommand('k8s.helm.release.revision.get.manifest', helmGetManifest);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.helm.release.revision.get.manifest.selected', helmGetManifestSelected);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.helm.release.revision.get.templates', helmGetTemplates);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.helm.release.revision.get.templates.selected', helmGetTemplatesSelected);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.helm.release.revision.get.values', helmGetValues);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.helm.release.revision.get.notes', helmGetNotes);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.helm.release.revision.get.hooks', helmGetHooks);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.helm.release.revision.get.hooks.selected', helmGetHooksSelected);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.helm.release.revision.get.chart', helmGetChart);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.helm.release.revision.get.info', helmGetInfo);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.helm.release.revision.get.some', helmGetSome);
    context.subscriptions.push(disposable);

    vscode.window.visibleTextEditors;

    disposable = vscode.window.onDidChangeVisibleTextEditors((e) => {
        Object.keys(templatePreviewTextEditorCache).forEach(key => {
            const cachedEditor = templatePreviewTextEditorCache[key];
            if (vscode.window.visibleTextEditors.findIndex(te => te === cachedEditor) === -1) {
                delete templatePreviewTextEditorCache[key];
                delete templatetHelmPreviewFileCache[key];
            }
        });
    });

    context.subscriptions.push(disposable);

    const fileSystemWatcher = vscode.workspace.createFileSystemWatcher("**/*.{yml,yaml}", true, false, true);
    fileSystemWatcher.onDidChange(templateChanged);
    context.subscriptions.push(fileSystemWatcher);

    setTimeout(async () => {
        const rv = await vscode.commands.executeCommand('workbench.view.extension.extension.vsKubernetesExplorer');
    }, 5000);
}

async function templateChanged(changeEvent: any) {
    const templateFilePath = changeEvent.fsPath;
    Object.keys(templatePreviewTextEditorCache).forEach(fsPath => {
        // Is the template being previewed ?
        if (templateFilePath.endsWith(fsPath)) {
            vscode.window.visibleTextEditors.forEach(textEditor => {
                // Find the text editor for the template
                if (textEditor.document.uri.fsPath === templateFilePath) {
                    helmTemplatePreview(textEditor);
                }
            });
        }
    })
}

async function helmTemplatePreview(editor?: vscode.TextEditor) {
    const templateFilePath = editor.document.uri.fsPath;
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]) {
        let folder = path.dirname(templateFilePath);
        while (isDirectory(folder)) {
            if (isFile(path.join(folder, 'Chart.yaml'))) {
                const templateFile = path.relative(folder, templateFilePath);

                let helmpreviewFilePath = templatetHelmPreviewFileCache[templateFile];
                if (!helmpreviewFilePath) {
                    const helmpreviewFilePathsMap = {};
                    const files = fs.readdirSync(folder);
                    files.forEach(file => {
                        const filePath = path.join(folder, file);
                        if (isFile(filePath) && file.endsWith(HELMPREVIEW_SUFFIX)) {
                            if (file === HELMPREVIEW_SUFFIX) {
                                helmpreviewFilePathsMap[HELMPREVIEW_SUFFIX] = filePath;
                            } else {
                                helmpreviewFilePathsMap[file.replace(/\.helmpreview$/, '')] = filePath;
                            }
                        }
                    });

                    helmpreviewFilePath = path.join(folder, '.helmpreview');
                    const keys = Object.keys(helmpreviewFilePathsMap);
                    if (keys.length === 1) {
                        helmpreviewFilePath = helmpreviewFilePathsMap[keys[0]];
                    } else if (keys.length > 1) {
                        const helmpreview = await vscode.window.showQuickPick(keys, {
                            placeHolder: `Select ${HELMPREVIEW_SUFFIX} profile to use for preview`
                        });
                        if (helmpreview) {
                            helmpreviewFilePath = helmpreviewFilePathsMap[helmpreview];
                        } else {
                            return;
                        }
                    } else {
                        return;
                    }
                }

                if (isFile(helmpreviewFilePath)) {
                    let templateCommand = fs.readFileSync(helmpreviewFilePath, {
                        encoding: 'utf8'
                    });
                    templateCommand = templateCommand.split(/\r?\n/g).join(' ');
                    const helm = await k8s.extension.helm.v1;
                    if (!helm.available) {
                        return;
                    }

                    const helmProcess = exec(`${templateCommand} --show-only ${templateFile}`, {
                        cwd: folder
                    },
                    async (error: Error, templatePreview: string, stderr: string) => {
                        if (error) {
                            vscode.window.showErrorMessage(stderr);
                        } else {
                            let templatePreviewTextEditorInThisGo = false;
                            let templatePreviewTextEditor: vscode.TextEditor =  templatePreviewTextEditorCache[templateFile];
                            if (templatePreviewTextEditor === undefined) {
                                // Open the document
                                let templatePreviewDocument: vscode.TextDocument = await vscode.workspace.openTextDocument({
                                    language: 'yaml',
                                    content: ''
                                });
                                templatePreviewTextEditor = await vscode.window.showTextDocument(templatePreviewDocument, vscode.ViewColumn.Beside);
                                templatePreviewTextEditorInThisGo = true;
                            }
                            if (!templatePreviewTextEditorInThisGo) {
                                // Remove from cache
                                delete templatePreviewTextEditorCache[templateFile];
                                delete templatetHelmPreviewFileCache[templateFile];
                            }
                            templatePreviewTextEditor.edit(editBuilder => {
                                // Put good templatePreviewTextEditor in cache
                                templatePreviewTextEditorCache[templateFile] = templatePreviewTextEditor;
                                templatetHelmPreviewFileCache[templateFile] = helmpreviewFilePath;
                                const document = templatePreviewTextEditor.document;
                                const fullRange = new vscode.Range(
                                    document.positionAt(0),
                                    document.positionAt(document.getText().length - 1)
                                );
                                editBuilder.replace(fullRange,
`${templatePreview}
# Preview generated using the following template command:
# ${templateCommand} --show-only ${templateFile}
# specified in file ${helmpreviewFilePath}.
`
                                );
                            });

                            if (!templatePreviewTextEditorInThisGo) {
                                let templatePreviewTextEditorFromCache: vscode.TextEditor = templatePreviewTextEditorCache[templateFile];
                                if (templatePreviewTextEditorFromCache === undefined) {
                                    // Looks like the editor did not get put back in cache - was probably a closed editor
                                    // TODO: recreate - for now let user know
                                    vscode.window.showWarningMessage('Preview was closed. Invoke Preview Template (using .helmpreview) command again.')
                                }
                            }

                            if (stderr) {
                                console.error(stderr);
                            }
                        }
                    });

                    // const templateShellResult = await helm.api.invokeCommand(`${templateCommand} --show-only ${templateFile}`);
                    // if (templateShellResult.code === 0) {
                    //     console.log(`${templateShellResult.stdout}\n# Generated using template command:\n# helm ${templateCommand} --show-only ${templateFile}\n`);
                    // }
                } else {
                    vscode.commands.executeCommand('extension.helmTemplatePreview');
                }
                break;
            }

            folder = path.dirname(folder);
        }
    }
}

async function helmGetManifest(target?: any) {
    helmGet(target, [MANIFEST]);
}

async function helmGetManifestSelected(target?: any) {
    helmGet(target, [MANIFEST], true);
}

async function helmGetTemplates(target?: any) {
    helmGet(target, [TEMPLATES]);
}

async function helmGetTemplatesSelected(target?: any) {
    helmGet(target, [TEMPLATES], true);
}

async function helmGetValues(target?: any) {
    helmGet(target, [VALUES]);
}

async function helmGetNotes(target?: any) {
    helmGet(target, [NOTES]);
}

async function helmGetHooks(target?: any) {
    helmGet(target, [HOOKS]);
}

async function helmGetHooksSelected(target?: any) {
    helmGet(target, [HOOKS], true);
}

async function helmGetChart(target?: any) {
    helmGet(target, [CHART]);
}

async function helmGetInfo(target?: any) {
    helmGet(target, [INFO]);
}

async function helmGetSome(target?: any) {
    helmGet(target, []);
}

async function helmGet(target: any, extractTypes: string[], selected = false) {
    const explorer = await k8s.extension.clusterExplorer.v1;
    if (!explorer.available) {
        vscode.window.showErrorMessage(`ClusterExplorer not available.`);
        return;
    }

    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showErrorMessage(`kubectl not available.`);
        return;
    }

    const helm = await k8s.extension.helm.v1;
    if (!helm.available) {
        return;
    }

    if (target) {
        const commandTarget = explorer.api.resolveCommandTarget(target);
        if (commandTarget) {
            let namespace: string;

            const namespaceShellResult = await kubectl.api.invokeCommand('config view --minify --output "jsonpath={..namespace}"');
            if (namespaceShellResult) {
                if (namespaceShellResult.code === 0) {
                    namespace = namespaceShellResult.stdout.split(/\r?\n/g).join('');
                }
            }

            let releaseName: string;
            let releaseRevision: string;
            if (commandTarget.nodeType === 'resource' && commandTarget.resourceKind.manifestKind === 'Secret') {
                const secretName = commandTarget.name;
                if (/sh\.helm\.release\.v\d+\..*.v\d+/.test(secretName)) {
                    const matches = secretName.match(/sh\.helm\.release\.v\d+\.(.*).v(\d)+/);
                    if (matches && matches.length === 3) {
                        releaseName = matches[1];
                        releaseRevision = matches[2];
                    }
                }
            } else if (commandTarget.nodeType === 'helm.release') {
                releaseName = commandTarget.name;
                const historyShellResult = await helm.api.invokeCommand(`history -o json ${releaseName}`);
                if (historyShellResult.code === 0) {
                    const historyJson = JSON.parse(historyShellResult.stdout);
                    const revisions = (historyJson.map((historyItem: any) => `${historyItem.revision}`) as string[]).reverse();

                    const revision = await vscode.window.showQuickPick(revisions, {
                        canPickMany: false,
                        placeHolder: 'Choose revision. 0 means latest'
                    });

                    if (!revision) {
                        return;
                    }
                    releaseRevision = revision;
                }
            } else if (target.nodeType === 'helm.history') {
                releaseName = target.releaseName;
                releaseRevision = target.release.revision;
            }

            helmGetAllReleaseRevisionFromNamespace(releaseName, releaseRevision, namespace, extractTypes, selected)
        }
    }
}

async function helmGetAllReleaseRevisionFromNamespace(releaseName: string, releaseRevision: string, namespace: string, extractTypes = [], selected: boolean) {
    const explorer = await k8s.extension.clusterExplorer.v1;
    if (!explorer.available) {
        vscode.window.showErrorMessage(`ClusterExplorer not available.`);
        return;
    }

    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showErrorMessage(`kubectl not available.`);
        return;
    }

    let helmGetExtractTypes: string[];
    if (extractTypes.length > 0) {
        helmGetExtractTypes = extractTypes;
    } else {
        helmGetExtractTypes = await vscode.window.showQuickPick(GET_TYPES, {
            canPickMany: true,
            placeHolder: 'Choose items for helm get ? release revision'
        })
    }

    if (!helmGetExtractTypes || helmGetExtractTypes.length === 0) {
        return;
    }

    const secretName = `sh.helm.release.v1.${releaseName}.v${releaseRevision}`;
    const shellResult = await kubectl.api.invokeCommand(`get secret ${secretName} -o go-template="{{.data.release | base64decode }}" -n ${namespace}`);
    if (shellResult && shellResult.code === 0) {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Getting ${selected ? 'selected ' : '' }[ ${helmGetExtractTypes.join(',')} ] from: Release: ${releaseName} Revision: ${releaseRevision}`
        }, (progress, token) => {
            return new Promise((resolve, reject) => {
                zlib.gunzip(Buffer.from(shellResult.stdout, 'base64'), async (e, inflated) => {
                    if (e) {
                        reject(e);
                    } else {
                        try {
                            const helmGetAllJSON: any = JSON.parse(inflated.toString('utf8'));
                            let notes = '';
                            let values = '';
                            let templates = '';
                            let manifests = '';
                            let hooks = '';
                            let chart = '';
                            let info = '';

                            notes = helmGetAllJSON.info.notes.split('\\n').join('\n');

                            helmGetAllJSON.chart.templates.forEach((template: any) => {
                                const templateString = Buffer.from(template.data, 'base64').toString('utf-8');
                                templates += `\n# Template: ${template.name}\n${templateString}\n# End Template: ${template.name}`;
                            });
                            templates = templates.split('\\n').join('\n');

                            if (helmGetAllJSON.config) {
                                values += `# value overrides\n---\n${YAML.stringify(helmGetAllJSON.config)}`;
                            }

                            values += `# values\n---\n${YAML.stringify(helmGetAllJSON.chart.values)}`;

                            manifests = helmGetAllJSON.manifest.split('\\n').join('\n');

                            helmGetAllJSON.hooks.forEach((hook: any) => {
                                hooks += `\n# Source: ${hook.path}\n${hook.manifest}\n---`;
                            });
                            hooks = hooks.split('\\n').join('\n');

                            helmGetAllJSON.chart.files.forEach((file: any) => {
                                file.data = Buffer.from(file.data, 'base64').toString('utf-8');
                            });

                            chart = YAML.stringify(helmGetAllJSON.chart.metadata);
                            info = YAML.stringify(helmGetAllJSON.info);

                            if (helmGetExtractTypes.indexOf(RAW) !== -1) {
                                // Open the get all document
                                const helmGetAllDocument: vscode.TextDocument = await vscode.workspace.openTextDocument({
                                    language: 'jsonc',
                                    content: `// helm get all ${releaseName} --revision ${releaseRevision} -n ${namespace}\n${JSON.stringify(helmGetAllJSON, null, '  ')}`
                                });
                                await vscode.window.showTextDocument(helmGetAllDocument, vscode.ViewColumn.Active);
                            }

                            if (helmGetExtractTypes.indexOf(NOTES) !== -1) {
                                // Open the get notes document
                                const notesDocument: vscode.TextDocument = await vscode.workspace.openTextDocument({
                                    language: 'plain',
                                    content: `# helm get notes ${releaseName} --revision ${releaseRevision} -n ${namespace}\n${notes}`
                                });
                                await vscode.window.showTextDocument(notesDocument, vscode.ViewColumn.Active);
                            }

                            if (helmGetExtractTypes.indexOf(HOOKS) !== -1) {
                                if (selected) {
                                    await helmExtract(releaseName, releaseRevision, namespace, HOOKS, hooks.split('\n'), 'yaml');
                                } else {
                                    // Open the get hooks document
                                    const hooksDocument: vscode.TextDocument = await vscode.workspace.openTextDocument({
                                        language: 'yaml',
                                        content: `# helm get hooks ${releaseName} --revision ${releaseRevision} -n ${namespace}\n${hooks}`
                                    });
                                    await vscode.window.showTextDocument(hooksDocument, vscode.ViewColumn.Active);
                                }
                            }

                            if (helmGetExtractTypes.indexOf(CHART) !== -1) {
                                // Open the get values document
                                const valuesDocument: vscode.TextDocument = await vscode.workspace.openTextDocument({
                                    language: 'yaml',
                                    content: `# helm get chart ${releaseName} --revision ${releaseRevision} -n ${namespace}\n${chart}`
                                });
                                await vscode.window.showTextDocument(valuesDocument, vscode.ViewColumn.Active);
                            }

                            if (helmGetExtractTypes.indexOf(INFO) !== -1) {
                                // Open the get values document
                                const valuesDocument: vscode.TextDocument = await vscode.workspace.openTextDocument({
                                    language: 'yaml',
                                    content: `# helm get info ${releaseName} --revision ${releaseRevision} -n ${namespace}\n${info}`
                                });
                                await vscode.window.showTextDocument(valuesDocument, vscode.ViewColumn.Active);
                            }

                            if (helmGetExtractTypes.indexOf(VALUES) !== -1) {
                                // Open the get values document
                                const valuesDocument: vscode.TextDocument = await vscode.workspace.openTextDocument({
                                    language: 'yaml',
                                    content: `# helm get values ${releaseName} --revision ${releaseRevision} -n ${namespace}\n${values}`
                                });
                                await vscode.window.showTextDocument(valuesDocument, vscode.ViewColumn.Active);
                            }

                            if (helmGetExtractTypes.indexOf(TEMPLATES) !== -1) {
                                if (selected) {
                                    await helmExtract(releaseName, releaseRevision, namespace, TEMPLATES, templates.split('\n'), 'helm');
                                } else {
                                    // Open the get templates document
                                    const templatesDocument: vscode.TextDocument = await vscode.workspace.openTextDocument({
                                        language: 'helm',
                                        content: `# helm get templates ${releaseName} --revision ${releaseRevision} -n ${namespace}\n${templates}`
                                    });
                                    await vscode.window.showTextDocument(templatesDocument, vscode.ViewColumn.Active);
                                }
                            }

                            if (helmGetExtractTypes.indexOf(MANIFEST) !== -1) {
                                if (selected) {
                                    await helmExtract(releaseName, releaseRevision, namespace, MANIFEST, manifests.split('\n'), 'yaml');
                                } else {
                                    // Open the get manifests document
                                    const manifestsDocument: vscode.TextDocument = await vscode.workspace.openTextDocument({
                                        language: 'yaml',
                                        content: `# helm get manifest ${releaseName} --revision ${releaseRevision} -n ${namespace}\n${manifests}`
                                    });
                                    await vscode.window.showTextDocument(manifestsDocument, vscode.ViewColumn.Beside);
                                }
                            }
                        } finally {
                            resolve(inflated);
                        }
                    }
                });
            });
        })
    } else {
        vscode.window.showErrorMessage(`Failed`);
    }
}

async function helmExtract(releaseName: string, releaseRevision: string, namespace: string, extractType: string, lines: string[], languageId: string) {
    const explorer = await k8s.extension.clusterExplorer.v1;
    if (!explorer.available) {
        return;
    }

    const helm = await k8s.extension.helm.v1;
    if (!helm.available) {
        return;
    }
    if (lines.length > 0) {
        const yamlFileToYamlMap = {};
        let yamlFile = undefined;
        let yamlLines = [];
        const startsWith = `# ${extractType === TEMPLATES ? 'Template: ' : 'Source: '}`
        const endStartsWith = `${extractType === TEMPLATES ? '# End Template: ' : '---'}`
        lines.forEach(line => {
            if (line.startsWith(endStartsWith)) {
                if (yamlFile !== undefined) {
                    yamlFileToYamlMap[yamlFile] = yamlLines;
                }
                yamlFile = undefined;
                yamlLines = [];
            } else if (line.startsWith(startsWith)) {
                yamlFile = line.substring(startsWith.length);
            } else {
                yamlLines.push(line);
            }
        });
        // Handle last
        if (yamlFile !== undefined) {
            yamlFileToYamlMap[yamlFile] = yamlLines;
        }
        yamlFile = undefined;
        yamlLines = [];

        const yamlFileNames = Object.keys(yamlFileToYamlMap);

        if (yamlFileNames.length === 0) {
            vscode.window.showInformationMessage(`No ${extractType} for release ${releaseName}.`);
            return;
        }

        const selected = await vscode.window.showQuickPick(yamlFileNames, {
            // canPickMany: true,
            placeHolder: `Choose ${extractType} to load.`
        });

        if (selected) {
            const yamlText = [
                `# ${selected} - ${extractType} Release: ${releaseName} Rivision: ${releaseRevision} Namespace: ${namespace}`,
                `${startsWith}${selected}`,
                '---',
                ...yamlFileToYamlMap[selected]
            ].join('\n') + '\n';
            // vscode.env.clipboard.writeText(yamlText);
            // vscode.window.showInformationMessage(`Copied ${extractType} ${selected} for release ${releaseName} to clipboard.`);

            // Open the document
            let templatePreviewDocument: vscode.TextDocument = await vscode.workspace.openTextDocument({
                language: selected.endsWith('.txt') ? 'plaintext' : languageId,
                content: yamlText
            });
            await vscode.window.showTextDocument(templatePreviewDocument, vscode.ViewColumn.Active);
        }
    }
}


export function deactivate() {
}

function isFile(path: string): boolean {
    if (fs.existsSync(path) && fs.statSync(path).isFile()) {
        return true;
    }
    return false;
}

function isDirectory(path: string): boolean {
    if (fs.existsSync(path) && fs.statSync(path).isDirectory()) {
        return true;
    }
    return false;
}