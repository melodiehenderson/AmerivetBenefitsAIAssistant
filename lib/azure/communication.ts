// @ts-nocheck
// Dead code — @azure/communication-* packages not installed
import { EmailClient } from '@azure/communication-email';
import { CommunicationIdentityClient } from '@azure/communication-identity';
import { logError } from '@/lib/logger';

export class AzureCommunicationService {
  private emailClient: EmailClient;
  private identityClient: CommunicationIdentityClient;

  constructor() {
    const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING;
    
    if (!connectionString) {
      throw new Error('AZURE_COMMUNICATION_CONNECTION_STRING is not configured');
    }

    this.emailClient = new EmailClient(connectionString);
    this.identityClient = new CommunicationIdentityClient(connectionString);
  }

  /**
   * Send email using Azure Communication Services
   */
  async sendEmail(params: {
    to: string;
    subject: string;
    htmlContent: string;
    textContent?: string;
    from?: string;
  }): Promise<void> {
    try {
      const { to, subject, htmlContent, textContent, from = 'noreply@benefits-chatbot.com' } = params;

      const message = {
        senderAddress: from,
        content: {
          subject,
          html: htmlContent,
          plainText: textContent || this.stripHtml(htmlContent),
        },
        recipients: {
          to: [{ address: to }],
        },
      };

      const poller = await this.emailClient.beginSend(message);
      const result = await poller.pollUntilDone();

      console.log('Email sent successfully', {
        messageId: result.id,
        to,
        subject,
      });
    } catch (error) {
      logError('Failed to send email', error);
      throw error;
    }
  }

  /**
   * Send welcome email to new users
   */
  async sendWelcomeEmail(userEmail: string, userName: string): Promise<void> {
    const htmlContent = `
      <html>
        <body>
          <h2>Welcome to Benefits Assistant!</h2>
          <p>Hi ${userName},</p>
          <p>Welcome to the AmeriVet Benefits Assistant! I'm here to help you understand and manage your employee benefits.</p>
          <p>You can ask me questions about:</p>
          <ul>
            <li>Health insurance plans and coverage</li>
            <li>Dental and vision benefits</li>
            <li>Retirement planning options</li>
            <li>Enrollment processes and deadlines</li>
            <li>Claims and provider information</li>
          </ul>
          <p>Just start chatting with me anytime you have questions!</p>
          <p>Best regards,<br>Your Benefits Assistant</p>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: userEmail,
      subject: 'Welcome to Benefits Assistant!',
      htmlContent,
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(userEmail: string, resetLink: string): Promise<void> {
    const htmlContent = `
      <html>
        <body>
          <h2>Password Reset Request</h2>
          <p>You requested a password reset for your Benefits Assistant account.</p>
          <p>Click the link below to reset your password:</p>
          <p><a href="${resetLink}" style="background-color: #0078d4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Reset Password</a></p>
          <p>This link will expire in 1 hour for security reasons.</p>
          <p>If you didn't request this reset, please ignore this email.</p>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: userEmail,
      subject: 'Password Reset - Benefits Assistant',
      htmlContent,
    });
  }

  /**
   * Send notification email
   */
  async sendNotificationEmail(userEmail: string, title: string, message: string): Promise<void> {
    const htmlContent = `
      <html>
        <body>
          <h2>${title}</h2>
          <p>${message}</p>
          <p>Best regards,<br>Benefits Assistant Team</p>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: userEmail,
      subject: title,
      htmlContent,
    });
  }

  /**
   * Strip HTML tags for plain text content
   */
  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}

// Export singleton instance
export const azureCommunicationService = new AzureCommunicationService();
