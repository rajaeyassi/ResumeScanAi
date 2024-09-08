require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const pdf = require('pdf-parse');
const session = require('express-session');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const cors = require('cors');
const Imap = require('imap');
const { simpleParser } = require('mailparser');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Configure CORS
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session setup
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true
}));

// Create a transporter for sending emails
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

// Send an email
app.post('/send', (req, res) => {
    const { name, email, message } = req.body;

    // Validate the input
    if (!name || !email || !message) {
        return res.status(400).send('All fields are required.');
    }

    // Send the email
    transporter.sendMail({
        from: email, // Sender address (email provided in the form)
        to: 'rajaekhalid123@gmail.com', // Recipient address
        subject: 'Contact Form Message', // Subject line
        text: `Message from ${name} (${email}):\n\n${message}`, // Plain text body
        html: `<p>Message from ${name} (${email}):</p><p>${message}</p>` // HTML body
    }, (error, info) => {
        if (error) {
            console.error('Error sending email:', error);
            return res.status(500).send('Failed to send message.');
        } else {
            console.log('Email sent:', info.response);
            res.send('Message sent successfully.');
        }
    });
});


// Serve Dashboard page first
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'Dashboard.html'));
});


    
// Serve signup page
app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// Serve login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'Dashboard.html'));
});

// Serve chatbot page after login
app.get('/chatbot', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chatbot.html'));
});

// Resume and Job Description processing logic
app.post('/process', upload.fields([{ name: 'resumeFile' }, { name: 'jobDescFile' }]), async (req, res) => {
    const { resumeFile, jobDescFile } = req.files;
    const { OPENAI_API_KEY } = process.env;

    if (!resumeFile || !jobDescFile) {
        return res.status(400).send('Both files are required.');
    }

    const resumeFilePath = resumeFile[0]?.path;
    const jobDescFilePath = jobDescFile[0]?.path;

    if (!OPENAI_API_KEY) {
        return res.status(500).send('API key is not set.');
    }

    try {
        const resumeData = fs.readFileSync(resumeFilePath);
        const jobDescData = fs.readFileSync(jobDescFilePath);

        const resumeText = await pdf(resumeData);
        const jobDescText = await pdf(jobDescData);

        const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: `Match the resume with the job description. Resume: ${resumeText.text}. Job Description: ${jobDescText.text}.` }
            ],
            max_tokens: 150
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        res.json(openaiResponse.data);
    } catch (error) {
        console.error('Error details:', error.response ? error.response.data : error.message);
        res.status(500).send('Error processing request');
    }
});

// Chat interaction route
app.post('/chat', async (req, res) => {
    const { query, result } = req.body;
    const { OPENAI_API_KEY } = process.env;

    if (!OPENAI_API_KEY) {
        return res.status(500).send('API key is not set.');
    }

    try {
        const message = `The user is asking: "${query}". Here is the analysis result: ${JSON.stringify(result)}.`;

        const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: message }
            ],
            max_tokens: 150
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        res.json({ reply: openaiResponse.data.choices[0].message.content });
    } catch (error) {
        console.error('Error details:', error.response ? error.response.data : error.message);
        res.status(500).send('Error processing request');
    }
});

// Function to connect to Gmail and fetch emails
const fetchEmails = () => {
    const imap = new Imap({
        user: process.env.EMAIL_USER,
        password: process.env.GMAIL_APP_PASSWORD,
        host: 'imap.gmail.com',
        port: 993,
        tls: true
    });

    function openInbox(cb) {
        imap.openBox('INBOX', false, cb);
    }

    imap.once('ready', () => {
        openInbox((err, box) => {
            if (err) throw err;
            const f = imap.seq.fetch('1:*', { bodies: '' });
            f.on('message', (msg, seqno) => {
                console.log('Message #%d', seqno);
                const prefix = '(#' + seqno + ') ';
                msg.on('body', (stream) => {
                    simpleParser(stream, (err, mail) => {
                        if (err) throw err;
                        console.log('Parsed Email:', mail.subject, mail.from.text, mail.text);
                    });
                });
                msg.once('attributes', (attrs) => {
                    const uid = attrs.uid;
                    imap.addFlags(uid, ['\\Seen'], (err) => {
                        if (err) throw err;
                    });
                });
                msg.once('end', () => {
                    console.log(prefix + 'Finished');
                });
            });
            f.once('error', (err) => {
                console.error('Fetch error:', err);
            });
            f.once('end', () => {
                console.log('Done fetching all messages!');
                imap.end();
            });
        });
    });

    imap.once('error', (err) => {
        console.error('IMAP error:', err);
    });

    imap.once('end', () => {
        console.log('Connection ended');
    });

    imap.connect();
};

// Fetch emails every 5 minutes
setInterval(fetchEmails, 5 * 60 * 1000); // 5 minutes

app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
