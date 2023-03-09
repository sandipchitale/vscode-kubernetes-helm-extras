# Helm Extras README

This VSCode extension builds on top of [Kubernetes](https://marketplace.visualstudio.com/items?itemName=ms-kubernetes-tools.vscode-kubernetes-tools) VSCode extension. It extends the support for Helm related functionality.

## Features

- Load templates of older Helm release revisions. `helm get ... ` does not support getting templates
- Preview rendered Helm templates including using custom overrides

### Preview of Helm templates using custom values

Supports preview of rendered Helm template using custom values using the command `Preview Template (using .helmpreview)`.

#### **How does it work ?**

It starts by looking for file `.helmpreview` in the root folder of the root chart containing the Helm template (languageId `helm-template`) open in the editor. You can write the `helm template ...` command with custom value overrides in the `.helmpreview` file. For example you can use the following command:

```
helm template -f override.yaml sample-release .
```

When the command `Preview Template (using .helmpreview)` is invoked it uses the command specified in `.helmpreview` file and appends `--show-only editedtemplate.yaml` to it, executes the command in the folder containing the `.helmpreview` file. For example:

```
helm template -f override.yaml sample-release . --show-only editedtemplate.yaml
```

The output is collected and shown in a temporary editor. It attempts to reuse the same temporary editor so you can invoke the preview command again and again. When a template is modified and saved and is being previewed then preview is updated automatically.

You can have multiple `.helmpreview` files e.g. `DEV.helmpreview`, `PROD.helmpreview` which have different `helm template ...` command in tme. In that case you will be prompted to select the file you want to use for preview.

### Supports following commands on Helm release nodes in Cluster explorer:

|Command|Description|Context|
|---|---|---|
|heml get manifest release revision|Load manifest for helm release revision.|Helm release secret with name pattern sh.helm.release.v1.```release`.v`revision`, Helm Relestory, Helm Revision|
|heml get selected manifest release revision|Load selected manifest for helm release revision.|Helm release secret with name pattern sh.helm.release.v1.`release`.v`revision`, Helm Relestory, Helm Revision|
|heml get templates release revision|Load templates for helm release revision.|Helm release secret with name pattern sh.helm.release.v1.`release`.v`revision`, Helm Relestory, Helm Revision|
|heml get selected templates release revision|Load selected templates for helm release revision.|Helm release secret with name pattern sh.helm.release.v1.`release`.v`revision`, Helm Relestory, Helm Revision|
|heml get values release revision|Load values for helm release revision.|Helm release secret with name pattern sh.helm.release.v1.`release`.v`revision`, Helm Relestory, Helm Revision|
|heml get notes release revision|Load notes for helm release revision.|Helm release secret with name pattern sh.helm.release.v1.`release`.v`revision`, Helm Relestory, Helm Revision|
|heml get hooks release revision|Load hooks for helm release revision.|Helm release secret with name pattern sh.helm.release.v1.`release`.v`revision`, Helm Relestory, Helm Revision|
|heml get selected hooks release revision|Load selected hooks for helm release revision.|Helm release secret with name pattern sh.helm.release.v1.`release`.v`revision`, Helm Relestory, Helm Revision|
|heml get chart release revision|Load chart for helm release revision.|Helm release secret with name pattern sh.helm.release.v1.`release`.v`revision`, Helm Relestory, Helm Revision|
|heml get info release revision|Load info for helm release revision.|Helm release secret with name pattern sh.helm.release.v1.`release`.v`revision`, Helm Relestory, Helm Revision|
|heml get release revision....|Choose and load information about helm release revision.|Helm release secret with name pattern sh.helm.release.v1.`release`.v`revision`, Helm Relestory, Helm Revision|
|||

## Requirements

This extension works with Microsoft [Kubernetes](https://marketplace.visualstudio.com/items?itemName=ms-kubernetes-tools.vscode-kubernetes-tools) extension.

## Known Issues

None

[File a issue](https://github.com/sandipchitale/vscode-kubernetes-helm-extras/issues)

## Release Notes

### 1.0.41

Initial release.

## See also

- [Kubernetes Api Resources in Clusters Explorer](https://marketplace.visualstudio.com/items?itemName=sandipchitale.vscode-kubernetes-api-resources)
- [Kubernetes Pod File System Explorer and extras](https://marketplace.visualstudio.com/items?itemName=sandipchitale.kubernetes-file-system-explorer)
- [Kubernetes Commander](https://marketplace.visualstudio.com/items?itemName=sandipchitale.vscode-kubernetes-commander-editor)

