import type { Metadata } from "next";
import Link from "next/link";
import { BrandEmblem } from "@/components/layout/brand";

export const metadata: Metadata = { title: "Política de Privacidade — Central Yawara" };

/**
 * Página pública (sem login), exigida pelo Google para publicar o acesso ao Drive.
 * Descreve o que o sistema realmente faz (ver docs/backend/seguranca.md); revise
 * junto com a diretoria ao mudar dados guardados, serviços usados ou contato.
 */
export default function PrivacidadePage() {
  return (
    <main className="atmos min-h-dvh px-6 py-12">
      <article className="mx-auto max-w-2xl space-y-5 text-[15px] leading-relaxed text-fg-muted [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-[20px] [&_h2]:font-bold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc">
        <BrandEmblem size={64} />
        <p className="eyebrow !text-gold-fg">Central Yawara</p>
        <h1 className="font-display text-[32px] font-bold text-fg">Política de Privacidade</h1>
        <p>
          Esta política explica como a Central Yawara, sistema interno de gestão da Associação Atlética Acadêmica de Psicologia
          Yawara, trata dados pessoais, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).
        </p>

        <h2>Quem usa e quem é responsável</h2>
        <p>
          A Central é usada apenas por integrantes da Atlética, com contas criadas por convite. A responsável pelo tratamento
          dos dados é a Associação Atlética Acadêmica de Psicologia Yawara.
        </p>

        <h2>Quais dados guardamos e para quê</h2>
        <ul>
          <li>Integrantes: nome, e-mail de acesso, cargo, departamentos e, se a pessoa quiser, foto de perfil — para login e controle de acesso.</li>
          <li>Compradores de rifas e campanhas: nome e contato — para registrar vendas e pagamentos.</li>
          <li>Participantes de projetos de extensão: nome e situação de presença — para listas de presença e certificados.</li>
          <li>Registros da Atlética: documentos, atas, lançamentos financeiros, comprovantes e artes de marketing.</li>
          <li>Registro de operações (auditoria): quem fez o quê e quando, para segurança e prestação de contas.</li>
        </ul>
        <p>Não pedimos CPF, endereço nem dados sensíveis. A senha é gerenciada pelo Google Firebase e nunca é vista pela Central.</p>

        <h2>Quem pode ver</h2>
        <p>
          Cada pessoa vê apenas o que o seu cargo permite. Dados de compradores, listas de presença e comprovantes têm acesso
          restrito, conferido no servidor. Exportações de divulgação nunca incluem dados pessoais.
        </p>

        <h2>Onde os dados ficam</h2>
        <ul>
          <li>Google Firebase (login e banco de dados).</li>
          <li>Vercel (hospedagem do sistema).</li>
          <li>
            Google Drive da Atlética, quando ativado: os arquivos enviados ficam numa pasta privada. A Central usa a permissão
            <code className="mx-1 rounded bg-sunken px-1 text-[13px]">drive.file</code>, que dá acesso somente aos arquivos que ela própria criou — nunca ao restante do Drive.
          </li>
        </ul>
        <p>Não vendemos nem compartilhamos dados com terceiros para publicidade. A Central não usa ferramentas de rastreamento ou anúncios.</p>

        <h2>Seus direitos</h2>
        <p>
          Você pode pedir acesso, correção ou exclusão dos seus dados pelo e-mail{" "}
          <a href="mailto:yawarapsicologia@gmail.com" className="font-semibold text-gold-fg hover:underline">yawarapsicologia@gmail.com</a>.
          Algumas informações podem ser mantidas pelo tempo necessário à prestação de contas da Atlética.
        </p>

        <p className="pt-4 text-[13px]">
          <Link href="/sobre" className="font-semibold text-gold-fg hover:underline">Sobre a Central</Link>
        </p>
      </article>
    </main>
  );
}
