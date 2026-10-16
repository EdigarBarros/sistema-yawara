# Custos e faturamento

> Valores e franquias mudam com frequência. Confira sempre as páginas oficiais
> de preços do Firebase e do Google Cloud antes de ativar recursos e configure
> **alertas de orçamento**. As estimativas abaixo são orientações, não
> garantias.

## O que exige o plano Blaze (pagamento por uso)

| Recurso | Por que a Central usa | Observação |
|---|---|---|
| Cloud Functions (2ª geração) | Todas as gravações, convites, busca, regras de negócio | Exige Blaze. Há franquia mensal de invocações e tempo de execução. O deploy usa Cloud Build e Artifact Registry (custos pequenos de build e armazenamento de imagens). |
| Cloud Storage (bucket padrão) | Documentos, comprovantes e arquivos de marketing | Projetos novos precisam do Blaze para o bucket padrão. A franquia sem custo do Storage vale apenas para buckets em algumas regiões dos EUA; em `southamerica-east1` há cobrança por GB armazenado e por download desde o primeiro byte (valores baixos para o volume esperado). |
| Cloud Scheduler | Rotina diária de limpeza de envios abandonados | Há uma pequena franquia de jobs gratuitos por conta de faturamento. |
| App Hosting (opcional) | Hospedagem do Next.js | Exige Blaze; cobra por uso de Cloud Run e tráfego. |
| reCAPTCHA Enterprise (App Check) | Proteção contra abuso | Franquia mensal de avaliações; acima dela há cobrança. |

## Uso esperado (Atlética com dezenas de integrantes)

- **Firestore:** leituras concentradas nas listagens (até 500 registros por
  módulo) e na grade das rifas (vendas da campanha). Gravações só pelas
  funções. Para dezenas de usuários, o consumo tende a ficar perto ou dentro
  da franquia diária gratuita.
- **Functions:** uma invocação por operação de escrita/busca. Instâncias
  mínimas = 0 (sem custo ocioso; a primeira chamada após inatividade é mais
  lenta). `maxInstances` limitado a 10 por função para conter custos.
- **Storage:** proporcional aos arquivos guardados; versões de documentos e
  comprovantes nunca são apagadas automaticamente (decisão de retenção).
- **TTL (só no Blaze):** remove automaticamente notificações antigas e
  controles técnicos, reduzindo armazenamento.

## Como controlar

1. Alertas de orçamento (50%, 90%, 100%) na conta de faturamento.
2. Revise mensalmente: Firebase → Uso e faturamento.
3. Limite tamanhos de arquivo (já aplicado: 10–50 MB conforme o tipo).
4. Mantenha `minInstances: 0` nas funções e no App Hosting, salvo necessidade.
5. Exclua projetos de teste que não estejam em uso.
