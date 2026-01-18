const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// --- CONFIGURATION ---
const PAGE_ACCESS_TOKEN = 'EAAI12hLrtqEBQXKdwMnbFTZCdXyEXHVWUsewGrZAK28NrIvSJZAS2mOQt1K7GbrfFdBgjJgtae4LxVaPJ2UPf3c20YAlvZAypZBk7jahFt7qu3wCyuUaIci5IsgI7ovwLXKJQiNUgvTUNjC08ECSv9xir82e8MKDzKMkyAag8ABgrPC3wjkNbGf2gUA5aX4NW9aP5y8S7pRFMiISunGCD0HGYNAZDZD';
const VERIFY_TOKEN = 'tata';
const MONGO_URI = 'mongodb+srv://rakotoniainalahatra3_db_user:RXy0cKTSWpXtgCUA@cluster0.gzeshjm.mongodb.net/proxyflow?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI).then(() => console.log("MongoDB Connecté"));

// --- MODÈLE UTILISATEUR ---
const UserSchema = new mongoose.Schema({
    psid: { type: String, unique: true },
    email: String,
    password: String,
    isRegistered: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' }, // IDLE, AWAITING_EMAIL, AWAITING_PASS, AWAITING_CAPTCHA
    captchaAnswer: Number
});
const User = mongoose.model('User', UserSchema);

// --- WEBHOOK ---
app.post('/webhook', async (req, res) => {
    let body = req.body;
    if (body.object === 'page') {
        for (const entry of body.entry) {
            let event = entry.messaging[0];
            let psid = event.sender.id;
            let user = await User.findOne({ psid }) || await User.create({ psid });

            if (event.message && event.message.text) {
                handleMessage(psid, event.message.text, user);
            } else if (event.postback) {
                handlePostback(psid, event.postback.payload, user);
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    }
});

// --- GESTION DES MESSAGES TEXTES (LOGIN / SIGNUP) ---
async function handleMessage(psid, text, user) {
    if (!user.isRegistered) {
        if (user.step === 'AWAITING_EMAIL') {
            user.email = text;
            user.step = 'AWAITING_PASS';
            await user.save();
            return sendText(psid, "🔐 Super. Maintenant, choisissez un mot de passe :");
        } 
        
        if (user.step === 'AWAITING_PASS') {
            user.password = text;
            // Génération du Captcha
            const n1 = Math.floor(Math.random() * 10);
            const n2 = Math.floor(Math.random() * 10);
            user.captchaAnswer = n1 + n2;
            user.step = 'AWAITING_CAPTCHA';
            await user.save();
            return sendText(psid, `🤖 Vérification : Combien font ${n1} + ${n2} ?`);
        }

        if (user.step === 'AWAITING_CAPTCHA') {
            if (parseInt(text) === user.captchaAnswer) {
                user.isRegistered = true;
                user.step = 'IDLE';
                await user.save();
                sendText(psid, "✅ Inscription validée ! Bienvenue chez ProxyFlow.");
                return sendWelcomeMessage(psid);
            } else {
                return sendText(psid, "❌ Mauvaise réponse. Réessayez le calcul.");
            }
        }
        
        return sendSignupPrompt(psid);
    }

    // Si déjà inscrit, renvoyer le menu principal si le texte n'est pas géré
    sendWelcomeMessage(psid);
}

// --- GESTION DES BOUTONS ---
async function handlePostback(psid, payload, user) {
    if (payload === 'START_SIGNUP') {
        user.step = 'AWAITING_EMAIL';
        await user.save();
        sendText(psid, "📧 Veuillez entrer votre adresse email pour créer votre compte :");
    } else if (user.isRegistered) {
        // Logique d'achat ici (USA -> Verizon/TMobile -> Binance/LTC)
        if (payload === 'START_ORDER') {
            sendOrderFlow(psid);
        }
    }
}

// --- FONCTIONS D'ENVOI ---
function sendSignupPrompt(psid) {
    const response = {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "button",
                "text": "Bienvenue sur ProxyFlow ! 🌐\nVeuillez créer un compte pour continuer.",
                "buttons": [{ "type": "postback", "title": "📝 Créer mon compte", "payload": "START_SIGNUP" }]
            }
        }
    };
    callSendAPI(psid, response);
}

function sendText(psid, text) {
    callSendAPI(psid, { "text": text });
}

function sendWelcomeMessage(psid) {
    const response = {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "button",
                "text": "ProxyFlow 🌐 | Menu Principal\nCompte actif.",
                "buttons": [
                    { "type": "postback", "title": "🛒 Acheter un proxy", "payload": "START_ORDER" },
                    { "type": "postback", "title": "📞 Support", "payload": "SUPPORT" }
                ]
            }
        }
    };
    callSendAPI(psid, response);
}

function callSendAPI(sender_psid, response) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
        recipient: { id: sender_psid },
        message: response
    }).catch(err => console.error("Erreur API:", err.response.data));
}

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']);
});

app.listen(3000, () => console.log("Serveur prêt avec Captcha et Login !"));
