const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

// CONFIGURATION
const PAGE_ACCESS_TOKEN = 'EAAI12hLrtqEBQXKdwMnbFTZCdXyEXHVWUsewGrZAK28NrIvSJZAS2mOQt1K7GbrfFdBgjJgtae4LxVaPJ2UPf3c20YAlvZAypZBk7jahFt7qu3wCyuUaIci5IsgI7ovwLXKJQiNUgvTUNjC08ECSv9xir82e8MKDzKMkyAag8ABgrPC3wjkNbGf2gUA5aX4NW9aP5y8S7pRFMiISunGCD0HGYNAZDZD';
const VERIFY_TOKEN = 'proxyflow_secret_2026';

// INFOS DE PAIEMENT
const BINANCE_ID = "1192024137";
const LTC_ADDRESS = "ltc1q64ycstakcvdycemj7tj9nexdnc25vv24l4vc8g";

app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', (req, res) => {
    let body = req.body;
    if (body.object === 'page') {
        body.entry.forEach(entry => {
            let webhook_event = entry.messaging[0];
            let sender_psid = webhook_event.sender.id;

            if (webhook_event.message) {
                sendWelcomeMessage(sender_psid);
            } else if (webhook_event.postback) {
                handlePostback(sender_psid, webhook_event.postback.payload);
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

function sendWelcomeMessage(sender_psid) {
    const response = {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "button",
                "text": "Bienvenue chez ProxyFlow ! 🌐\nNos proxys ISP (USA) sont à 4$. Choisissez une option :",
                "buttons": [
                    { "type": "postback", "title": "🛒 Acheter un proxy", "payload": "START_ORDER" },
                    { "type": "postback", "title": "ℹ️ À propos", "payload": "ABOUT" },
                    { "type": "postback", "title": "📞 Support", "payload": "SUPPORT" }
                ]
            }
        }
    };
    callSendAPI(sender_psid, response);
}

function handlePostback(sender_psid, payload) {
    let response;

    switch (payload) {
        case 'START_ORDER':
            response = {
                "attachment": {
                    "type": "template",
                    "payload": {
                        "template_type": "button",
                        "text": "🌍 Pays : USA uniquement.\nCliquez pour continuer :",
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
                            { "type": "postback", "title": "Verizon", "payload": "PAY_METHOD_VERIZON" },
                            { "type": "postback", "title": "T-Mobile", "payload": "PAY_METHOD_TMOBILE" }
                        ]
                    }
                }
            };
            break;

        case 'PAY_METHOD_VERIZON':
        case 'PAY_METHOD_TMOBILE':
            const provider = (payload.includes('VERIZON')) ? "Verizon" : "T-Mobile";
            response = {
                "attachment": {
                    "type": "template",
                    "payload": {
                        "template_type": "button",
                        "text": `💳 Paiement pour 1 Proxy ISP USA (${provider})\nTotal : 4$\n\nChoisissez votre méthode :`,
                        "buttons": [
                            { "type": "postback", "title": "Binance Pay", "payload": "INFO_BINANCE" },
                            { "type": "postback", "title": "Litecoin (LTC)", "payload": "INFO_LTC" }
                        ]
                    }
                }
            };
            break;

        case 'INFO_BINANCE':
            response = { "text": `🆔 BINANCE PAY\n\nEnvoyez exactement 4 USDT à l'ID suivant :\n👉 ${BINANCE_ID}\n\nUne fois envoyé, contactez le support avec une capture d'écran pour recevoir vos accès.` };
            break;

        case 'INFO_LTC':
            response = { "text": `🚀 LITECOIN (LTC)\n\nAdresse de paiement :\n👉 ${LTC_ADDRESS}\n\nEnvoyez l'équivalent de 4$ en LTC. Envoyez la preuve au support ensuite.` };
            break;

        case 'ABOUT':
            response = { "text": "ProxyFlow : Proxys ISP Premium (Verizon/T-Mobile). Qualité résidentielle, haute vitesse, 4$ l'unité." };
            break;

        case 'SUPPORT':
            response = { "text": "💬 Le support est à votre écoute. Envoyez votre message ou votre preuve de paiement ici." };
            break;
    }
    callSendAPI(sender_psid, response);
}

function callSendAPI(sender_psid, response) {
    axios({
        method: 'POST',
        url: 'https://graph.facebook.com/v19.0/me/messages',
        params: { access_token: PAGE_ACCESS_TOKEN },
        data: { recipient: { id: sender_psid }, message: response }
    }).catch(err => console.error("Erreur API:", err.response ? err.response.data : err.message));
}

app.listen(process.env.PORT || 3000, () => console.log(`ProxyFlow actif !`));
