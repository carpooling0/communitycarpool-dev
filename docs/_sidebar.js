// Shared sidebar for all user docs articles
// Usage: <script>DOC_ACTIVE='filename-without-extension'</script><script src="_sidebar.js"></script>
(function(){
  const sections = [
    { label: 'Getting Started', links: [
      { href: 'what-is-community-carpool.html', text: 'What is Community Carpool?' },
      { href: 'submitting-your-journey.html',   text: 'Submitting your journey' },
      { href: 'after-you-submit.html',           text: 'What happens after you submit' },
    ]},
    { label: 'Your Matches', links: [
      { href: 'accessing-your-matches.html',     text: 'Accessing your matches page' },
      { href: 'match-strength.html',             text: 'Understanding match strength' },
      { href: 'expressing-interest.html',        text: 'Expressing interest or declining' },
      { href: 'mutual-match.html',               text: 'What happens when it\'s mutual' },
    ]},
    { label: 'Privacy & Your Data', links: [
      { href: 'how-information-is-protected.html', text: 'How your information is protected' },
      { href: 'name-and-email-visibility.html',    text: 'When your name & email are visible' },
      { href: 'data-storage.html',                 text: 'What data we store & for how long' },
    ]},
    { label: 'Managing Your Journey', links: [
      { href: 'multiple-journeys.html',          text: 'Submitting multiple journeys' },
      { href: 'pausing-deactivating.html',       text: 'Pausing or deactivating a journey' },
      { href: 'email-notifications.html',        text: 'Managing email notifications' },
      { href: 'deleting-account.html',           text: 'Deleting your account' },
    ]},
    { label: 'Troubleshooting & Support', links: [
      { href: 'no-matches-yet.html',                        text: 'Why haven\'t I received any matches?' },
      { href: 'how-long-matching-takes.html',               text: 'How long does matching take?' },
      { href: 'link-not-working.html',                      text: 'My matches link isn\'t working' },
      { href: 'i-moved-resubmit.html',                      text: 'I moved — do I need to resubmit?' },
      { href: 'expressed-interest-nothing-happened.html',   text: 'I expressed interest — what now?' },
      { href: 'not-receiving-emails.html',                  text: 'I\'m not receiving emails' },
      { href: 'getting-support.html',                       text: 'How to contact support' },
    ]},
  ];

  const active = window.DOC_ACTIVE || '';
  let html = '';
  sections.forEach(sec => {
    html += `<div class="sidebar-section"><div class="sidebar-section-label">${sec.label}</div>`;
    sec.links.forEach(l => {
      const isActive = active && l.href.replace('.html','') === active ? ' active' : '';
      html += `<a class="sidebar-link${isActive}" href="${l.href}">${l.text}</a>`;
    });
    html += '</div>';
  });

  const el = document.getElementById('sidebar-nav');
  console.log('[sidebar] el:', el, 'html length:', html.length, 'DOC_ACTIVE:', window.DOC_ACTIVE);
  if (el) el.innerHTML = html;
})();
