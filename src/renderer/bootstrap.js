(function bootstrapRendererBundle() {
  if (document.querySelector('script[data-celcat-renderer-bundle]')) {
    return;
  }

  var rendererScript = document.createElement('script');
  rendererScript.src = './renderer.js';
  rendererScript.async = false;
  rendererScript.dataset.celcatRendererBundle = 'true';
  document.body.appendChild(rendererScript);
})();
