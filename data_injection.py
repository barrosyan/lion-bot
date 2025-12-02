import requests
import sqlite3

DB_NAME = 'autoatendimento.db'

def setup_database():
    """Cria a conexão com o banco de dados e as tabelas CLIENTES e PROJETOS."""
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS clientes (
                id TEXT PRIMARY KEY,
                nome TEXT NOT NULL,
                documento TEXT
            );
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS projetos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                id_cliente TEXT NOT NULL,
                tipo TEXT,
                nome TEXT,
                percentual_conclusao REAL,
                data TEXT,
                FOREIGN KEY (id_cliente) REFERENCES clientes(id)
            );
        ''')
        
        conn.commit()
        print(f"✅ Tabelas criadas ou já existentes no banco de dados '{DB_NAME}'.")
        return conn
    except sqlite3.Error as e:
        print(f"❌ Erro ao configurar o banco de dados: {e}")
        return None

url_cards = "https://lionengenharia.api.groner.app/api/lead/cards"
bearer_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6WyIyIiwiSm9yZ2UgTGXDo28gIl0sImp0aSI6IjU1NTE0ZTE2NDhmMTQ0N2M4Yzg0YWJkZTY2NjE1MTMxIiwicm9sZSI6IkFkbWluaXN0cmFkb3IiLCJGdW5jYW8iOiJBZG1pbmlzdHJhZG9yIiwiVGltZVpvbmUiOiIiLCJFbWFpbCI6ImpvcmdlbGVhb2pyQGdtYWlsLmNvbSIsIklkIjoiMiIsIm5iZiI6MTc2Mjg4NzgwNywiZXhwIjoxNzYyOTc0MjA3LCJpYXQiOjE3NjI4ODc4MDcsImlzcyI6InJvbmFsZG8iLCJhdWQiOiJ0b3B6ZXJhIn0.VNyxf66q7AefPGtcccFUVrgmdBVMhp2CFhDWug83ltk" # Token de exemplo, ATUALIZE-O!

headers = {
    "Accept": "application/json, text/plain, */*",
    "Authorization": f"Bearer {bearer_token}",
    "sec-fetch-mode": "cors",
    "Referer": "https://lionengenharia.groner.app/",
    "Origin": "https://lionengenharia.groner.app/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0"
}

params_default = {
    "pageSize": 15,
    "pageNumber": 1
}

def fetch_and_insert_data(conn):
    """Realiza a requisição à API e insere os dados no banco de dados."""
    cursor = conn.cursor()
    
    try:
        print("Iniciando requisição para obter IDs dos leads...")
        response_cards = requests.get(url_cards, params=params_default, headers=headers)
        response_cards.raise_for_status()

        print("✅ Requisição de Cards bem-sucedida.")
        dados_json = response_cards.json()
        
        if 'Content' not in dados_json or 'ids' not in dados_json['Content']:
            print("❌ Estrutura de resposta inesperada na requisição de cards.")
            return

        ids_contatos = dados_json['Content']['ids']

        for lead_id in ids_contatos:
            print(f"\n--- Processando Lead ID: {lead_id} ---")
            
            url_lead_detail = f"https://lionengenharia.api.groner.app/api/lead/{lead_id}"
            
            try:
                response_lead = requests.get(url_lead_detail, params=params_default, headers=headers)
                response_lead.raise_for_status()

                dados_lead = response_lead.json()
                dados_cliente = dados_lead['Content']
                
                documento = dados_cliente.get('documentoTratado', 'N/A')
                nome_cliente = dados_cliente.get('nome', 'N/A')
                
                cursor.execute('''
                    INSERT OR REPLACE INTO clientes (id, nome, documento) 
                    VALUES (?, ?, ?)
                ''', (str(lead_id), nome_cliente, documento))
                conn.commit()
                print(f"✅ Cliente ID {lead_id} (Nome: {nome_cliente}) inserido/atualizado.")

            except requests.exceptions.RequestException as e:
                print(f"❌ Erro ao buscar detalhes do lead {lead_id}: {e}")
            except KeyError:
                print(f"❌ Estrutura de resposta inesperada para detalhes do lead {lead_id}.")
            
            
            url_projetos = (
                f'https://lionengenharia.api.groner.app/api/projeto?'
                f'pageSize=5&pageNumber=1&criterio=Todos&leadId={lead_id}&'
                f'ordenarPor=DataCadastro_ASC&statusId=&VendedorResponsavelId=&'
                f'tecnicoResponsavelId=&TipoProjetoId=&origemId='
            )
            
            try:
                response_projetos = requests.get(url_projetos, params={}, headers=headers)
                response_projetos.raise_for_status()

                dados_projetos_json = response_projetos.json()
                projetos = dados_projetos_json['Content']['list']
                
                if not projetos:
                    print(f"ℹ️ Nenhum projeto encontrado para o Lead ID {lead_id}.")
                    continue

                for projeto in projetos:
                    data_projeto = projeto.get('dataInclusao')
                    status_info = projeto.get('status', {})
                    tipo = status_info.get('tipo', 'N/A')
                    nome_status = status_info.get('nome', 'N/A')
                    percentual = status_info.get('porcentagemPrevisao', 0.0)

                    cursor.execute('''
                        INSERT INTO projetos (id_cliente, tipo, nome, percentual_conclusao, data)
                        VALUES (?, ?, ?, ?, ?)
                    ''', (str(lead_id), tipo, nome_status, percentual, data_projeto))
                    print(f"    - Projeto '{nome_status}' (Conclusão: {percentual}%) inserido.")
                    conn.commit()    
                print(f"✅ {len(projetos)} projetos inseridos para o Lead ID {lead_id}.")

            except requests.exceptions.RequestException as e:
                print(f"❌ Erro ao buscar projetos para o lead {lead_id}: {e}")
            except KeyError:
                print(f"❌ Estrutura de resposta inesperada para projetos do lead {lead_id}.")

        conn.commit()
        print("\n--- Processo concluído ---")
        print(f"Todos os dados foram inseridos com sucesso em '{DB_NAME}'.")

    except requests.exceptions.RequestException as e:
        print(f"❌ Ocorreu um erro durante a requisição inicial ou subsequente: {e}")
    except Exception as e:
        print(f"❌ Ocorreu um erro inesperado: {e}")
    finally:
        if conn:
            conn.close()
            print("Conexão com o banco de dados fechada.")


if __name__ == "__main__":
    db_connection = setup_database()
    if db_connection:
        fetch_and_insert_data(db_connection)


# TODO: Inserir Links de vídeos
# TODO: Caso já tenha o id, não inserir. Para os projetos, caso já tenha, não inserir.
# TODO: 