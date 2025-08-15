// backend/services/emailService.js
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

class EmailService {
    constructor() {
        if (!process.env.EMAIL_HOST || !process.env.EMAIL_PORT || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.warn('⚠️ Email credentials not fully provided in .env. Email sending will not work.');
            this.transporter = null;
        } else {
            this.transporter = nodemailer.createTransport({
                host: process.env.EMAIL_HOST,
                port: process.env.EMAIL_PORT,
                secure: process.env.EMAIL_PORT == 465, // true for 465 (SSL), false for other ports (TLS)
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS,
                },
            });

            // Verify connection configuration
            this.transporter.verify((error) => {
                if (error) {
                    console.error('❌ Nodemailer transporter verification failed:', error);
                    // You might want to throw an error here or set a flag to prevent email sending attempts
                } else {
                    console.log('✅ Nodemailer transporter ready to send emails');
                }
            });
        }
    }

    /**
     * Sends an OTP (One-Time Password) email to the specified address.
     * @param {string} toEmail - The recipient's email address.
     * @param {string} otpCode - The 6-digit OTP code to send.
     */
    async sendOtpEmail(toEmail, otpCode) {
        if (!this.transporter) {
            console.error('Email service not initialized. Cannot send OTP email.');
            throw new Error('Email service not available. Please check server configuration.');
        }

        const mailOptions = {
            from: process.env.EMAIL_USER, // Sender address, should match EMAIL_USER
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
            throw new Error(`Failed to send OTP email: ${error.message}`);
        }
    }
}

export { EmailService };