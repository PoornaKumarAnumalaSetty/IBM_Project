// Class: EmailService
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

class EmailService {
    constructor() {
        const {
            EMAIL_SERVICE,
            EMAIL_HOST,
            EMAIL_PORT,
            EMAIL_USER,
            EMAIL_PASS,
            EMAIL_SECURE,
            EMAIL_REQUIRE_TLS,
            EMAIL_CONNECTION_TIMEOUT,
            EMAIL_SOCKET_TIMEOUT,
            DEV_EMAIL_MODE,
        } = process.env;

        this.isDevEmailMode = DEV_EMAIL_MODE === 'console';

        if (!EMAIL_USER || !EMAIL_PASS) {
            console.warn('⚠️ Email credentials not fully provided in .env. Email sending will not work.');
            this.transporter = null;
        } else if (process.env.EMAIL_SERVICE === 'gmail') {
            this.transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS,
                },
                pool: true,
                connectionTimeout: Number(process.env.EMAIL_CONNECTION_TIMEOUT || 10000),
                socketTimeout: Number(process.env.EMAIL_SOCKET_TIMEOUT || 10000),
            });
        } else if (EMAIL_HOST && EMAIL_PORT) {
            // Generic SMTP with proper TLS settings
            const portNum = Number(EMAIL_PORT);
            this.transporter = nodemailer.createTransport({
                host: EMAIL_HOST,
                port: portNum,
                secure: (EMAIL_SECURE === 'true') || portNum === 465, // SSL on 465
                requireTLS: (EMAIL_REQUIRE_TLS === 'true') || portNum === 587,  // STARTTLS on 587
                auth: {
                    user: EMAIL_USER,
                    pass: EMAIL_PASS,
                },
                pool: true,
                connectionTimeout: Number(EMAIL_CONNECTION_TIMEOUT || 10000),
                socketTimeout: Number(EMAIL_SOCKET_TIMEOUT || 10000),
            });
        } else {
            console.warn('⚠️ Email host/port not provided. Email sending will not work.');
            this.transporter = null;
        }

        if (this.transporter) {
            this.transporter.verify((error) => {
                if (error) {
                    console.error('❌ Nodemailer transporter verification failed:', error);
                } else {
                    console.log('✅ Nodemailer transporter ready to send emails');
                }
            });
        }
    }

    async sendOtpEmail(toEmail, otpCode) {
        if (!this.transporter) {
            if (this.isDevEmailMode) {
                console.warn('DEV EMAIL MODE: Transporter not available. Logging OTP instead.');
                console.log(`DEV OTP -> ${toEmail}: ${otpCode}`);
                return { messageId: 'dev-console', accepted: [toEmail] };
            }
            console.error('Email service not initialized. Cannot send OTP email.');
            throw new Error('Email service not available. Please check server configuration.');
        }

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: toEmail,
            subject: 'Your MoodGram Verification Code (OTP)',
            html: `
                <p>Hello,</p>
                <p>Thank you for registering with MoodGram! Use the following One-Time Password (OTP) to verify your email address:</p>
                <h2 style="color: #6a0dad; font-size: 24px; text-align: center; margin: 20px 0; padding: 10px; border: 2px dashed #6a0dad; display: inline-block; letter-spacing: 3px;">${otpCode}</h2>
                <p>This OTP is valid for 5 minutes.</p>
                <p>If you did not request this, please ignore this email.</p>
                <p>Best regards,</p>
                <p>The MoodGram Team</p>
            `,
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            console.log(`✅ OTP email sent to ${toEmail}. Message ID: ${info.messageId}`);
            return info;
        } catch (error) {
            console.error(`❌ Error sending OTP email to ${toEmail}:`, error);

            // Helpful message for common timeout case
            if (error && (error.code === 'ESOCKET' || error.code === 'ETIMEDOUT' || error.syscall === 'connect')) {
                console.error('SMTP connection timed out. If using Gmail, set EMAIL_SERVICE=gmail and use an App Password. On networks that block SMTP, use dev fallback.');
            }

            if (this.isDevEmailMode) {
                console.warn('DEV EMAIL MODE: Email send failed, but proceeding. OTP is logged above.');
                return { messageId: 'dev-fallback', accepted: [toEmail] };
            }

            throw new Error(`Failed to send OTP email: ${error.message}`);
        }
    }
}

export { EmailService };