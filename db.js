import sqlite3 from "sqlite3";
sqlite3.verbose();

const db = new sqlite3.Database("./autoatendimento.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE, -- Um registro por telefone
      flow TEXT,
      state TEXT,
      data TEXT, -- Dados específicos do flow e histórico recente
      long_term_summary TEXT, -- Resumo de longo prazo
      last_message_at INTEGER, -- Timestamp da última mensagem
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS media_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER,
      filename TEXT,
      path TEXT,
      contentType TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );
  `);
});

export default db;
