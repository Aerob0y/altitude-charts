(function () {
  var header = document.querySelector('.site-head');
  if (!header) return;
  var toggle = header.querySelector('.menu-toggle');
  var nav = header.querySelector('#main-nav');
  if (!toggle || !nav) return;
  function setOpen(open) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.documentElement.classList.toggle('menu-open', open);
  }
  toggle.addEventListener('click', function () {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });
  header.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
  nav.addEventListener('click', function (event) {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('click', function (event) {
    if (!header.contains(event.target)) setOpen(false);
  });
  window.matchMedia('(max-width: 900px)').addEventListener('change', function (event) {
    if (event.matches && nav.contains(document.activeElement)) toggle.focus();
    setOpen(false);
  });
  toggle.hidden = false;
  header.classList.add('nav-ready');
})();
