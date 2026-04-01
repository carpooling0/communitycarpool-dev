// Super-Admin Docs session guard
// Requires a valid ccp_admin_token in localStorage (set by admin.html on login).
// If no token or token is invalid/expired → redirects to admin.html.
// Body is hidden via CSS until auth is confirmed to prevent content flash.
(async function () {
  const token = localStorage.getItem('ccp_admin_token')
  if (!token) { redirect(); return }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'me', token })
    })
    const data = await res.json()
    if (data && data.adminId) {
      document.body.style.visibility = 'visible'
    } else {
      redirect()
    }
  } catch (e) {
    // Network error — fail open so admins aren't locked out by a flaky connection
    document.body.style.visibility = 'visible'
  }

  function redirect () {
    // Depth: docs/super-admin/ → ../../admin.html
    const depth = location.pathname.split('/').filter(Boolean).length - 1
    const prefix = '../'.repeat(depth)
    window.location.replace(prefix + 'admin.html')
  }
})()
