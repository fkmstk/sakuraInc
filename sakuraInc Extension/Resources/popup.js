const versionNode = document.getElementById("popup-version");
if (versionNode) {
    versionNode.textContent = `Version ${browser.runtime.getManifest().version}`;
}
