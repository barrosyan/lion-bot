import express from "express";
import dotenv from "dotenv";
import whatsappRoutes from "./routes/whatsapp.js";
import { upload } from "./services/storageService.js";
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());
app.use("/uploads", express.static("uploads"));

app.use("/whatsapp", whatsappRoutes);

app.post("/upload", upload.single("file"), (req, res) => {
  res.json({ message: "Upload concluído!", path: req.file.path });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
