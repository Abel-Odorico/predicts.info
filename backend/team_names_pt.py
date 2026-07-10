"""Espelho de frontend/src/utils/teamNames.js — nomes em pt-BR por código FIFA (3 letras).
Usado pelo parser do bot WhatsApp pra reconhecer "França"/"Marrocos"/"Suíça" etc, já que
teams.name no banco é em inglês (France/Morocco/Switzerland). Atualizar os dois arquivos juntos
se a lista de seleções mudar."""

PT_NAMES = {
    "ALG": "Argélia", "ARG": "Argentina", "AUS": "Austrália",
    "AUT": "Áustria", "BEL": "Bélgica", "BIH": "Bósnia e Herz.",
    "BRA": "Brasil", "CAN": "Canadá", "CIV": "Costa do Marfim",
    "COD": "Congo (RDC)", "COL": "Colômbia", "CPV": "Cabo Verde",
    "CRO": "Croácia", "CUW": "Curaçao", "CZE": "Rep. Tcheca",
    "ECU": "Equador", "EGY": "Egito", "ENG": "Inglaterra",
    "ESP": "Espanha", "FRA": "França", "GER": "Alemanha",
    "GHA": "Gana", "HAI": "Haiti", "IRN": "Irã",
    "IRQ": "Iraque", "JOR": "Jordânia", "JPN": "Japão",
    "KOR": "Coreia do Sul", "KSA": "Arábia Saudita", "MAR": "Marrocos",
    "MEX": "México", "NED": "Holanda", "NOR": "Noruega",
    "NZL": "Nova Zelândia", "PAN": "Panamá", "PAR": "Paraguai",
    "POR": "Portugal", "QAT": "Catar", "RSA": "África do Sul",
    "SCO": "Escócia", "SEN": "Senegal", "SUI": "Suíça",
    "SWE": "Suécia", "TUN": "Tunísia", "TUR": "Turquia",
    "URU": "Uruguai", "USA": "Estados Unidos", "UZB": "Uzbequistão",
}
