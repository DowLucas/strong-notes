package email

import (
	"fmt"
	"html"
)

// MagicLinkSubject is the subject for the sign-in code email.
const MagicLinkSubject = "Your sign-in code for Strong Notes"

// MagicLinkBody renders the text and HTML bodies for the sign-in email.
//
// The email carries the raw one-time code, presented as a copyable block —
// the verify endpoint is POST-only, so a tappable link would do nothing in a
// mail client. expiryMinutes is interpolated from the actual MagicLinkTTL
// configured on the server so the user sees the real expiry, not a hardcoded
// guess.
//
// The HTML version is intentionally minimal: no images, no inline-CSS
// framework, no tracking pixels.
func MagicLinkBody(code string, expiryMinutes int) (text, htmlBody string) {
	text = fmt.Sprintf(`Hi,

Enter this code in the app to sign in to Strong Notes:

    %s

The code expires in %d minutes. If you didn't request a sign-in code, you can ignore this email — no action is needed.

— Strong Notes
`, code, expiryMinutes)

	safeCode := html.EscapeString(code)
	htmlBody = fmt.Sprintf(`<!doctype html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.5;">
<p>Hi,</p>
<p>Enter this code in the app to sign in to Strong Notes:</p>
<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 18px; padding: 12px 16px; background: #f0e5cc; color: #2d1f1a; border-radius: 6px; display: inline-block; user-select: all; -webkit-user-select: all;">%s</pre>
<p>The code expires in %d minutes. If you didn't request a sign-in code, you can ignore this email — no action is needed.</p>
<p>— Strong Notes</p>
</body>
</html>`, safeCode, expiryMinutes)

	return text, htmlBody
}
