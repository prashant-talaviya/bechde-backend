import nodemailer from "nodemailer";

export const emailConfigured = () => !!process.env.GMAIL_USER?.trim() && !!process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '');

function createGmailTransport() {
  if (!emailConfigured()) throw new Error('Gmail credentials are missing in .env');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER!.trim(), pass: process.env.GMAIL_APP_PASSWORD!.replace(/\s/g, '') },
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000, dnsTimeout: 10000,
  });
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export async function sendMarketplaceEmail(input: { email: string; name: string; subject: string; body: string; screen: 'my-ads' | 'chat'; requestId: string }) {
  const sender = process.env.GMAIL_USER?.trim();
  const action = input.screen === 'chat' ? 'Open BechDe and go to Chats to reply to this buyer.' : 'Open BechDe and go to My Ads to view your listing and review details.';
  const greeting = input.name.trim() ? `Hi ${input.name.trim()},` : 'Hi there,';
  const transporter = createGmailTransport();
  await transporter.sendMail({
    from: { name: 'BechDe', address: sender! }, to: { name: input.name, address: input.email },
    subject: `[BechDe] ${input.subject}`,
    messageId: `<bechde-${input.requestId}@${sender!.split('@')[1]}>`,
    text: `${greeting}\n\n${input.body}\n\n${action}\n\nThe BechDe team`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#171C1B;line-height:1.6">
      <h1 style="color:#075E54;font-size:24px">BechDe</h1>
      <h2 style="font-size:20px">${escapeHtml(input.subject)}</h2>
      <p>${escapeHtml(greeting)}</p><p style="white-space:pre-wrap">${escapeHtml(input.body)}</p>
      <p style="background:#F0F5F2;padding:16px;border-radius:10px;color:#075E54">${action}</p>
      <p>The BechDe team</p></div>`,
  });
}

export const sendOTPEmail = async (
  email: string,
  otp: string
): Promise<void> => {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPassword) {
    throw new Error("Gmail credentials are missing in .env");
  }

  // Connect to Gmail using the app password from .env.
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser.trim(),
      pass: gmailPassword.replace(/\s/g, "")
    }
  });

  // Provide plain text and HTML versions for different email clients.
  await transporter.sendMail({
    from: `"BechDe" <${gmailUser}>`,
    to: email,
    subject: "Your BechDe verification code",

    text: `Your BechDe OTP is ${otp}. It expires in 5 minutes. Do not share it with anyone.`,

    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:24px">
        <h2 style="color:#075E54">Welcome to BechDe!</h2>
        <p>Your email verification code is:</p>
        <h1 style="letter-spacing:8px;color:#075E54">${otp}</h1>
        <p>This code expires in 5 minutes.</p>
        <p>Never share this code with anyone.</p>
      </div>
    `
  });
};
