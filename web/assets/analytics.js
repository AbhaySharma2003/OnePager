// Microsoft Clarity: heatmaps and session recordings for softlaunch.in.
// CLARITY_ID is the project ID from clarity.microsoft.com (Settings > Overview). Empty = off.
// Never runs on localhost, so local testing stays out of the data.
// Students' CV content is hidden from recordings with data-clarity-mask on the app's views.
(function () {
  var CLARITY_ID = "z2r3euxkzf";
  if (!CLARITY_ID || /^(localhost|127\.|\[::1\])/.test(location.hostname)) return;
  (function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, "clarity", "script", CLARITY_ID);
})();
