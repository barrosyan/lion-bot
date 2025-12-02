import express from 'express';
import cors from 'cors';

const app = express();

// CORS liberado totalmente — ideal para testes
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());

// Endpoint do webhook
app.post('/webhook', (req, res) => {
  const { from, body } = req.body;

  console.log("Recebido:", req.body);

  // Simule qualquer resposta que quiser
  res.json({
    reply: `Recebi a mensagem: ${body} (de ${from})`
  });
});

// Preflight (OPTIONS)
app.options('/webhook', (req, res) => {
  res.sendStatus(200);
});

// Inicialização
app.listen(3000, () => {
  console.log('Servidor rodando em http://localhost:3000');
});
