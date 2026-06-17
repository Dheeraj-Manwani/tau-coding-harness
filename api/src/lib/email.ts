import { Resend } from "resend";
import jwt from "jsonwebtoken";
import { env } from "./env";

const resend = new Resend(env.RESEND_API_KEY ?? "");
const FROM = env.EMAIL_FROM;
const APP_URL = env.APP_URL;
const VERIFICATION_SECRET = env.ACCESS_TOKEN_SECRET;

export async function sendVerificationEmail(input: {
  userId: string;
  email: string;
}): Promise<void> {
  const token = jwt.sign(
    { sub: input.userId, purpose: "email_verification" },
    VERIFICATION_SECRET,
    { expiresIn: "1d" },
  );
  const verifyUrl = `${APP_URL}/verify-email?token=${token}`;

  await resend.emails.send({
    from: FROM,
    to: input.email,
    subject: "Verify your email",
    html: `
      <p>Welcome to Tau!</p>
      <p>Confirm your email by clicking the link below:</p>
      <p><a href="${verifyUrl}">Verify my email</a></p>
      <p>This link expires in 24 hours.</p>
    `,
  });
}
