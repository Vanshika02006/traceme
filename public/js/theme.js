// Runs before first paint (classic script in <head>) so there is no theme flash.
(function () {
  var stored = null;
  try { stored = localStorage.getItem('traceme-theme'); } catch (e) { /* storage blocked */ }
  var theme = stored === 'light' || stored === 'dark'
    ? stored
    : (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', theme);
})();
