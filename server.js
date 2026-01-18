const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

// Configuration
const PAGE_ACCESS_TOKEN = 'EAAI12hLrtqEBQXKdwMnbFTZCdXyEXHVWUsewGrZAK28NrIvSJZAS2mOQt1K7GbrfFdBgjJgtae4LxVaPJ2UPf3c20YAlvZAypZBk7jahFt7qu3wCyuUaIci5IsgI7ovwLXKJQiNUgvTUNjC08ECSv9xir82e8MKDzKMkyAag8ABgrPC3wjkNbGf2gUA5aX4NW9aP5y8S7pRFMiISunGCD0HGYNAZDZD';
const VERIFY_TOKEN = 'proxyflow_secret_2026'; // À copier dans le champ "Vérifier le jeton" sur Meta

// 1. Route de vérification (Meta Dashboard)
app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);      
        }
    }
});

// 2. Réception des messages et clics
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

// 3. Le message de bienvenue avec boutons
function sendWelcomeMessage(sender_psid) {
    const response = {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "button",
                "text": "Bienvenue chez ProxyFlow ! 🌐\n\nBesoin de proxys ISP ultra-rapides ? Vous êtes au bon endroit.",
                "buttons": [
                    {
                        "type": "postback",
                        "title": "🛒 Acheter Proxy (3.5$)",
                        "payload": "BUY_PROXY"
                    },
                    {
                        "type": "postback",
                        "title": "ℹ️ À propos",
                        "payload": "ABOUT"
                    },
                    {
                        "type": "postback",
                        "title": "📞 Parler au support",
                        "payload": "SUPPORT"
                    }
                ]
            }
        }
    };
    callSendAPI(sender_psid, response);
}

// 4. Gestion des actions (Postbacks)
function handlePostback(sender_psid, payload) {
    let response;

    switch (payload) {
        case 'BUY_PROXY':
            response = { "text": "💳 Proxy ISP (Statique/Résidentiel)\n\nPrix : 3.5$\nStatut : En stock\n\nPour commander, cliquez sur ce lien de paiement sécurisé : [LIEN_STRIPE_OU_PAYPAL]" };
            break;
        case 'ABOUT':
            response = { "text": "ProxyFlow fournit des proxys ISP. Contrairement aux proxys classiques, ils sont reconnus comme des connexions domestiques réelles, ce qui évite les blocages sur les sites sensibles." };
            break;
        case 'SUPPORT':
            response = { "text": "🚀 Un agent va prendre connaissance de votre message. Vous pouvez poser votre question directement ici." };
            break;
    }
    callSendAPI(sender_psid, response);
}

// 5. Envoi vers Facebook Graph API
function callSendAPI(sender_psid, response) {
    axios({
        method: 'POST',
        url: 'https://graph.facebook.com/v19.0/me/messages',
        params: { access_token: PAGE_ACCESS_TOKEN },
        data: {
            recipient: { id: sender_psid },
            message: response
        }
    }).catch(err => {
        console.error("Erreur API Facebook:", err.response ? err.response.data : err.message);
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ProxyFlow tourne sur le port ${PORT}`));
