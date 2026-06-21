import { Resend } from "resend";
import jwt from "jsonwebtoken";
import { env } from "./env";
import { Errors } from "./errors";

const resend = new Resend(env.RESEND_API_KEY ?? "");
const FROM = env.EMAIL_FROM;
const APP_URL = env.APP_URL;
const VERIFICATION_SECRET = env.ACCESS_TOKEN_SECRET;
const VERIFICATION_PURPOSE = "email_verification";

const BRAND = {
  void: "#07070f", // page background
  surface: "#0c0f14", // card background
  border: "#1e2532",
  text: "#e2e8f0", // primary text
  muted: "#94a3b8", // secondary text
  blue: "#60a5fa", // accent / button
  blueDeep: "#3b82f6",
} as const;

/**
 * Dark, brand-themed verification email. Uses table layout and inline styles
 * for broad email-client compatibility.
 */
function verificationEmailHtml(verifyUrl: string): string {
  return `
  <!DOCTYPE html>
  <html lang="en">
    <body style="margin:0;padding:0;background-color:${BRAND.void};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.void};padding:40px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <tr>
                <td style="padding:32px 40px 8px;">
                  <span style="font-size:24px;font-weight:600;letter-spacing:0.04em;color:#ffffff;">&#964;&nbsp;tau</span>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 40px 0;">
                  <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:600;color:${BRAND.text};">Welcome to Tau!</h1>
                  <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${BRAND.muted};">
                    Confirm your email address to finish setting up your account.
                  </p>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding:0 40px 8px;">
                  <table role="presentation" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center" style="border-radius:10px;background-color:${BRAND.blue};background-image:linear-gradient(135deg,${BRAND.blue},${BRAND.blueDeep});">
                        <a href="${verifyUrl}" target="_blank"
                          style="display:inline-block;padding:13px 32px;font-size:15px;font-weight:600;color:${BRAND.void};text-decoration:none;border-radius:10px;">
                          Verify my email
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 40px 32px;">
                  <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${BRAND.muted};">
                    This link expires in 24 hours. If the button doesn't work, paste this URL into your browser:
                  </p>
                  <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;">
                    <a href="${verifyUrl}" target="_blank" style="color:${BRAND.blue};text-decoration:none;">${verifyUrl}</a>
                  </p>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;font-size:12px;color:${BRAND.muted};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              If you didn't create a Tau account, you can safely ignore this email.
            </p>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;
}

export async function sendVerificationEmail(input: {
  userId: string;
  email: string;
}): Promise<void> {
  const token = jwt.sign(
    { sub: input.userId, purpose: VERIFICATION_PURPOSE },
    VERIFICATION_SECRET,
    { expiresIn: "1d" },
  );
  const verifyUrl = `${APP_URL}/verify-email?token=${token}`;

  const res = await resend.emails.send({
    from: FROM,
    to: input.email,
    subject: "Verify your email",
    html: verificationEmailHtml(verifyUrl),
  });

  console.log("from : ", FROM, "to :: ", input.email, res);
}

/** Verify an email-verification JWT and return the user id it was issued for. */
export function verifyEmailToken(token: string): { userId: string } {
  try {
    const decoded = jwt.verify(token, VERIFICATION_SECRET) as {
      sub?: string;
      purpose?: string;
    };
    if (decoded.purpose !== VERIFICATION_PURPOSE || !decoded.sub) {
      throw new Error("Invalid verification token");
    }
    return { userId: decoded.sub };
  } catch {
    throw Errors.unauthorized("Invalid or expired verification link");
  }
}
