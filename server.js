const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// CONFIGURATION
const PAGE_ACCESS_TOKEN = 'EAAI12hLrtqEBQXKdwMnbFTZCdXyEXHVWUsewGrZAK28NrIvSJZAS2mOQt1K7GbrfFdBgjJgtae4LxVaPJ2UPf3c20YAlvZAypZBk7jahFt7qu3wCyuUaIci5IsgI7ovwLXKJQiNUgvTUNjC08ECSv9xir82e8MKDzKMkyAag8ABgrPC3wjkNbGf2gUA5aX4NW9aP5y8S7pRFMiISunGCD0HGYNAZDZD';
const VERIFY_TOKEN = 'proxyflow_secret_2026';
const MONGO_URI = 'mongodb+srv://rakotoniainalahatra3_db_user:RXy0cKTSWpXtgCUA@cluster0.gzeshjm.mongodb.net/proxyflow?retryWrites=true&w=majority';

// CONNEXION MONGODB
mongoose.connect(MONGO_URI)
    .then(() => console.log("Connecté à MongoDB !"))
    .catch(err => console.error("Erreur de connexion MongoDB:", err));

// MODELE UTILISATEUR
const UserSchema = new mongoose.Schema({
    psid: { type: String, unique: true },
    isRegistered: { type: Boolean, default: false },
    signupDate: { type: Date, default: Date.now },
    balance: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

// WEBHOOK
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else { res.sendStatus(403); }
});

app.post('/webhook', async (req, res) => {
    let body = req.body;
    if (body.object === 'page') {
        for (const entry of body.entry) {
            let webhook_event = entry.messaging[0];
            let sender_psid = webhook_event.sender.id;

            // Verification ou Creation de l'utilisateur
            let user = await User.findOne({ psid: sender_psid });
            if (!user) {
                user = await User.create({ psid: sender_psid });
            }

            if (webhook_event.message) {
                if (!user.isRegistered) {
                    sendSignupPrompt(sender_psid);
                } else {
                    sendWelcomeMessage(sender_psid);
                }
            } else if (webhook_event.postback) {
                handlePostback(sender_psid, webhook_event.postback.payload, user);
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else { res.sendStatus(404); }
});

// PROMPT D'INSCRIPTION
function sendSignupPrompt(sender_psid) {
    const response = {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "button",
                "text": "Bienvenue sur ProxyFlow ! 🌐\nPour accéder à nos services, veuillez créer votre compte.",
                "buttons": [{ "type": "postback", "title": "📝 S'inscrire maintenant", "payload": "CONFIRM_SIGNUP" }]
            }
        }
    };
    callSendAPI(sender_psid, response);
}

// LOGIQUE DES POSTBACKS
async function handlePostback(sender_psid, payload, user) {
    let response;

    // Si l'utilisateur n'est pas inscrit, il ne peut QUE s'inscrire
    if (!user.isRegistered && payload !== 'CONFIRM_SIGNUP') {
        return sendSignupPrompt(sender_psid);
    }

    switch (payload) {
        case 'CONFIRM_SIGNUP':
            await User.findOneAndUpdate({ psid: sender_psid }, { isRegistered: true });
            response = { "text": "✅ Inscription réussie ! Vous pouvez maintenant acheter des proxys." };
            callSendAPI(sender_psid, response);
            setTimeout(() => sendWelcomeMessage(sender_psid), 1000);
            return;

        case 'START_ORDER':
            response = {
                "attachment": {
                    "type": "template",
                    "payload": {
                        "template_type": "button",
                        "text": "🌍 Choisissez le pays :",
                        "buttons": [{ "type": "postback", "title": "🇺🇸 USA", "payload": "SELECT_USA" }]
                    }
                }
            };
            break;

        case 'SELECT_USA':
            response = {
                "attachment": {
                    "type": "template",
                    "payload": {
                        "template_type": "button",
                        "text": "📶 Choisissez votre fournisseur (4$) :",
                        "buttons": [
                            { "type": "postback", "title": "Verizon", "payload": "PAY_VERIZON" },
                            { "type": "postback", "title": "T-Mobile", "payload": "PAY_TMOBILE" }
                        ]
                    }
                }
            };
            break;

        // ... (Ajouter ici les cas INFO_BINANCE et INFO_LTC du code précédent)
    }
    callSendAPI(sender_psid, response);
}

function sendWelcomeMessage(sender_psid) {
    const response = {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "button",
                "text": "ProxyFlow 🌐 | Votre compte est actif.\nQue souhaitez-vous faire ?",
                "buttons": [
                    { "type": "postback", "title": "🛒 Acheter un proxy", "payload": "START_ORDER" },
                    { "type": "postback", "title": "📞 Support", "payload": "SUPPORT" }
                ]
            }
        }
    };
    callSendAPI(sender_psid, response);
}

function callSendAPI(sender_psid, response) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
        recipient: { id: sender_psid },
        message: response
    }).catch(err => console.error("Erreur API:", err.response.data));
}

app.listen(process.env.PORT || 3000, () => console.log(`ProxyFlow avec MongoDB est prêt !`));
