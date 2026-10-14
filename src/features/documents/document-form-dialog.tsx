"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { DocumentLinks } from "@/types";
import { services } from "@/services";
import { useAccess } from "@/hooks/use-access";
import { useAction } from "@/hooks/use-action";
import { useDirectory, useDocumentCategories } from "@/hooks/use-data";
import { audienceSchema, audienceError, requiredText } from "@/lib/validation";
import { emptyAudience } from "@/lib/permissions";
import { liveRegister } from "@/lib/forms";
import { fileExtension, formatBytes } from "@/lib/format";
import { errorMessage } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { FilePicker } from "@/components/shared/pickers";
import { AudiencePicker, AudienceSummary } from "@/components/shared/audience";
import { DemoNotice } from "@/components/shared/states";
import { DetailList } from "@/components/shared/page";

export const DOC_SCOPES = ["department", "board", "all", "roles", "people"] as const;
export const DOC_SCOPE_LABELS = { all: "Todos os integrantes autorizados" };

const schema = z.object({
  name: requiredText("o nome do documento", 3),
  description: z.string().trim().max(500),
  categoryId: z.string().min(1, "Escolha a categoria."),
  departmentId: z.string().min(1, "Escolha o departamento."),
  status: z.enum(["current", "draft"]),
  access: audienceSchema,
});
type Values = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  links?: DocumentLinks;
  defaultCategoryId?: string;
  /** Ao concluir: abre o documento (padrão) ou permanece na tela atual. */
  stay?: boolean;
  onCreated?: (id: string) => void;
}

export function AddDocumentDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <AddDocumentBody {...props} />}
    </Dialog>
  );
}

function AddDocumentBody({ onOpenChange, links, defaultCategoryId, stay, onCreated }: Props) {
  const router = useRouter();
  const access = useAccess();
  const dir = useDirectory();
  const { data: categories } = useDocumentCategories();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [serverError, setServerError] = useState<string>();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      description: "",
      categoryId: defaultCategoryId ?? "",
      departmentId: access.role?.departmentId ?? "",
      status: "current",
      access: emptyAudience("department"),
    },
  });
  const register = liveRegister(form);
  const { control, handleSubmit, formState, setValue, getValues } = form;
  const accessValue = useWatch({ control, name: "access" });
  const departmentId = useWatch({ control, name: "departmentId" });

  const create = useAction(
    (v: Values) =>
      services.documents.create(
        { ...v, access: v.access.scope === "department" ? { ...v.access, departmentId: v.departmentId } : v.access, links },
        file,
      ),
    { success: "Documento adicionado", successDescription: "Disponível apenas nesta demonstração local, neste navegador.", silentError: true },
  );

  const onSubmit = handleSubmit(async (v) => {
    if (!file) {
      setFileError("Escolha um arquivo do seu computador ou celular.");
      return;
    }
    setServerError(undefined);
    try {
      const doc = await create.run(v);
      onOpenChange(false);
      onCreated?.(doc.id);
      if (!stay) router.push(`/documentos/${doc.id}`);
    } catch (e) {
      setServerError(errorMessage(e));
    }
  });

  return (
    <DialogContent
      size="lg"
      modal
      title="Adicionar documento"
      description="O arquivo fica somente neste navegador nesta etapa — não é enviado a nenhum servidor."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={onSubmit} loading={create.pending}>
            Adicionar documento
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <section>
          <p className="mb-2 text-[13px] font-medium">
            Arquivo <span className="text-gold-fg">*</span>
          </p>
          <FilePicker
            file={file}
            onChange={(f) => {
              setFile(f);
              setFileError(undefined);
              if (f && !getValues("name")) setValue("name", f.name.replace(/\.[^.]+$/, ""), { shouldValidate: true });
            }}
            hint="PDF, imagens, planilhas ou textos — até 25 MB."
          />
          {fileError && (
            <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
              {fileError}
            </p>
          )}
          {file && (
            <DetailList
              className="mt-3"
              items={[
                { label: "Formato", value: fileExtension(file.name) },
                { label: "Tamanho", value: formatBytes(file.size) },
                { label: "Autor do envio", value: access.user?.name },
                { label: "Data do envio", value: "Registrada ao salvar" },
              ]}
            />
          )}
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do documento" required className="sm:col-span-2" error={formState.errors.name?.message}>
            <Input {...register("name")} />
          </Field>
          <Field label="Descrição" optional className="sm:col-span-2">
            <Textarea rows={2} {...register("description")} />
          </Field>
          <Field label="Categoria" required error={formState.errors.categoryId?.message}>
            <Select {...register("categoryId")}>
              <option value="">Selecione…</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Departamento" required error={formState.errors.departmentId?.message}>
            <Select {...register("departmentId")}>
              {dir.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Situação" required>
            <Select {...register("status")}>
              <option value="current">Vigente</option>
              <option value="draft">Em elaboração</option>
            </Select>
          </Field>
        </section>

        <section className="space-y-3">
          <p className="text-[13px] font-medium">Quem pode acessar</p>
          <Controller
            control={control}
            name="access"
            render={({ field }) => (
              <AudiencePicker
                name="doc-access"
                value={field.value}
                onChange={field.onChange}
                scopes={[...DOC_SCOPES]}
                labels={DOC_SCOPE_LABELS}
                departmentId={departmentId}
                error={audienceError(formState.errors.access)}
              />
            )}
          />
          <div className="rounded-lg border border-line bg-sunken px-4 py-3">
            <AudienceSummary audience={accessValue} departmentId={departmentId} labels={DOC_SCOPE_LABELS} alwaysIncluded={access.user ? [access.user.id] : []} />
          </div>
        </section>

        <DemoNotice>Compartilhamento simulado. A autorização real e o armazenamento no Firebase Storage serão implementados no backend.</DemoNotice>
        {serverError && (
          <p role="alert" className="rounded-lg border border-danger/35 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
            {serverError}
          </p>
        )}
      </form>
    </DialogContent>
  );
}
