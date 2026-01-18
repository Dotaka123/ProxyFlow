const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// --- CONFIGURATION ---
const PAGE_ACCESS_TOKEN = 'EAAI12hLrtqEBQXKdwMnbFTZCdXyEXHVWUsewGrZAK28NrIvSJZAS2mOQt1K7GbrfFdBgjJgtae4LxVaPJ2UPf3c20YAlvZAypZBk7jahFt7qu3wCyuUaIci5IsgI7ovwLXKJQiNUgvTUNjC08ECSv9xir82e8MKDzKMkyAag8ABgrPC3wjkNbGf2gUA5aX4NW9aP5y8S7pRFMiISunGCD0HGYNAZDZD';
const VERIFY_TOKEN = 'tata';
const MONGO_URI = 'mongodb+srv://rakotoniainalahatra3_db_user:RXy0cKTSWpXtgCUA@cluster0.gzeshjm.mongodb.net/proxyflow?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI).then(() => console.log("✅ MongoDB Connecté"));

// --- MODÈLES ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true },
    email: String, password: String,
    balance: { type: Number, default: 0 },
    isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' },
    captchaAnswer: Number
}));

const Deposit = mongoose.model('Deposit', new mongoose.Schema({
    psid: String,
    binanceId: String,
    amount: { type: Number, default: 0 },
    status: { type: String, default: 'EN_ATTENTE' }, // EN_ATTENTE, VALIDÉ
    date: { type: Date, default: Date.now }
}));

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

async function handleMessage(psid, text, user) {
    // Logique Login/Signup (Identique précédent)
    if (user.step.startsWith('SIGNUP_') || user.step.startsWith('LOGIN_')) {
        return handleAuthSteps(psid, text, user); 
    }

    // Étape : Réception de l'ID Binance pour dépôt
    if (user.step === 'AWAITING_DEPOSIT_ID') {
        await Deposit.create({ psid: psid, binanceId: text });
        user.step = 'IDLE';
        await user.save();
        return sendText(psid, `✅ Merci ! Votre ID Binance (${text}) a été transmis. \nUn administrateur créditera votre solde après vérification du transfert de 4$ ou plus.`);
    }

    if (!user.isLoggedIn) return sendAuthPrompt(psid);
    sendWelcomeMenu(psid, user);
}

async function handlePostback(psid, payload, user) {
    if (!user.isLoggedIn && !['GOTO_SIGNUP', 'GOTO_LOGIN'].includes(payload)) return sendAuthPrompt(psid);

    switch (payload) {
        case 'ADD_FUNDS':
            sendText(psid, "💰 Pour recharger votre compte (Min 4$) :\n\n1. Envoyez vos USDT vers Binance ID : 1192024137\n2. Une fois fait, ENVOYEZ VOTRE ID BINANCE ici même.");
            user.step = 'AWAITING_DEPOSIT_ID';
            await user.save();
            break;

        case 'START_ORDER':
            if (user.balance < 4) return sendText(psid, `❌ Solde insuffisant (${user.balance}$). Veuillez recharger votre compte.`);
            sendButtons(psid, "🌍 Choisissez le pays :", [{ "title": "🇺🇸 USA", "payload": "BUY_USA" }]);
            break;

        case 'BUY_USA':
            sendButtons(psid, "📶 Fournisseur (4$ /unité) :", [
                { "title": "Verizon", "payload": "CONFIRM_BUY_Verizon" },
                { "title": "T-Mobile", "payload": "CONFIRM_BUY_T-Mobile" }
            ]);
            break;

        case payload.startsWith('CONFIRM_BUY_') ? payload : null:
            const provider = payload.replace('CONFIRM_BUY_', '');
            if (user.balance >= 4) {
                user.balance -= 4;
                await user.save();
                sendText(psid, `✅ Achat réussi ! 1 Proxy ISP USA (${provider}) a été débité de votre solde.\n\nVotre nouveau solde : ${user.balance}$\n\n🚀 Vos accès arrivent dans quelques instants.`);
                // Ici tu pourrais notifier ton admin pour livrer
            }
            break;

        case 'MY_ACCOUNT':
            sendText(psid, `👤 Compte : ${user.email}\n💰 Solde actuel : ${user.balance}$`);
            break;
            
        case 'GOTO_SIGNUP': user.step = 'SIGNUP_EMAIL'; await user.save(); sendText(psid, "📧 Email :"); break;
        case 'GOTO_LOGIN': user.step = 'LOGIN_EMAIL'; await user.save(); sendText(psid, "📧 Email :"); break;
    }
}

// --- HELPERS ---
function sendWelcomeMenu(psid, user) {
    sendButtons(psid, `ProxyFlow 🌐 | Solde: ${user.balance}$`, [
        { "title": "🛒 Acheter Proxy", "payload": "START_ORDER" },
        { "title": "💰 Recharger", "payload": "ADD_FUNDS" },
        { "title": "👤 Mon Compte", "payload": "MY_ACCOUNT" }
    ]);
}

function sendAuthPrompt(psid) {
    sendButtons(psid, "ProxyFlow 🌐 | Bienvenue", [
        { "title": "📝 S'inscrire", "payload": "GOTO_SIGNUP" },
        { "title": "🔑 Connexion", "payload": "GOTO_LOGIN" }
    ]);
}

function sendText(psid, text) { callSendAPI(psid, { "text": text }); }
function sendButtons(psid, text, btns) {
    const buttons = btns.map(b => ({ "type": "postback", "title": b.title, "payload": b.payload }));
    callSendAPI(psid, { "attachment": { "type": "template", "payload": { "template_type": "button", "text": text, "buttons": buttons } } });
}
function callSendAPI(psid, response) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message: response });
}

// Note: handleAuthSteps doit contenir la logique d'email/pass/captcha des messages précédents.

app.get('/webhook', (req, res) => { if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']); });
app.listen(3000, () => console.log("🚀 ProxyFlow avec Système de Balance actif !"));
