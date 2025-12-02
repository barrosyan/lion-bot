import requests
import json

fluxo_de_mensagens = {
    "+5584991287602":["Bom dia.", "10668024402", "1", "2", "2-1"]}

url = "http://localhost:3000/whatsapp/webhook"

file_path = r'uploads\Causas-de-infiltracao-e-umidade-no-piso-1024x683.jpg'

payload = {
    "from": "+5584991287602",
    "body": "Segue a foto do problema"
}

files = {
    "media": (
        file_path,
        open(file_path, "rb"),
        "image/jpeg"
    )
}

headers = {
    "Content-Type": "application/json"
}

response = requests.post(url, data=payload, files=files)
response = requests.post(url, data=json.dumps(payload), headers=headers)

print("Status Code:", response.status_code)
print("Resposta JSON:")
print(response.json())
