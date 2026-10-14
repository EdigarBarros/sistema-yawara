"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import * as PO from "@radix-ui/react-popover";
import * as TB from "@radix-ui/react-tabs";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------ Dropdown ------------------------------ */

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({ className, align = "end", sideOffset = 6, ...props }: ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          "z-50 min-w-[200px] overflow-hidden rounded-lg border border-line-strong bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in",
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

interface ItemProps extends ComponentProps<typeof DM.Item> {
  icon?: ReactNode;
  tone?: "default" | "danger";
  hint?: ReactNode;
}

export function DropdownMenuItem({ className, icon, tone = "default", hint, children, ...props }: ItemProps) {
  return (
    <DM.Item
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] outline-none select-none",
        "data-[highlighted]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45",
        tone === "danger" ? "text-danger" : "text-fg",
        "[&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {icon && <span className={tone === "danger" ? "text-danger" : "text-fg-muted"}>{icon}</span>}
      <span className="min-w-0">
        {children}
        {hint && <span className="block text-xs text-fg-subtle">{hint}</span>}
      </span>
    </DM.Item>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("eyebrow px-2.5 pt-2 pb-1.5", className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-line" />;
}

/* ------------------------------- Popover ------------------------------ */

export const Popover = PO.Root;
export const PopoverTrigger = PO.Trigger;
export const PopoverClose = PO.Close;

export function PopoverContent({ className, align = "end", sideOffset = 8, ...props }: ComponentProps<typeof PO.Content>) {
  return (
    <PO.Portal>
      <PO.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn("z-50 rounded-xl border border-line-strong bg-surface shadow-pop outline-none data-[state=open]:animate-pop-in", className)}
        {...props}
      />
    </PO.Portal>
  );
}

/* -------------------------------- Abas -------------------------------- */

export const Tabs = TB.Root;
export const TabsContent = ({ className, ...props }: ComponentProps<typeof TB.Content>) => (
  <TB.Content className={cn("outline-none", className)} {...props} />
);

export function TabsList({ className, ...props }: ComponentProps<typeof TB.List>) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <TB.List className={cn("flex min-w-max gap-1 border-b border-line", className)} {...props} />
    </div>
  );
}

export function TabsTrigger({ className, children, count, ...props }: ComponentProps<typeof TB.Trigger> & { count?: number }) {
  return (
    <TB.Trigger
      className={cn(
        "relative -mb-px inline-flex h-10 items-center gap-2 border-b-2 border-transparent px-3 text-[13.5px] font-medium text-fg-muted transition-colors",
        "hover:text-fg data-[state=active]:border-gold data-[state=active]:text-fg [&_svg]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && <span className="rounded-full bg-surface-3 px-1.5 font-mono text-[11px] text-fg-muted">{count}</span>}
    </TB.Trigger>
  );
}
