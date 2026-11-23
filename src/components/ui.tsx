"use client";

/**
 * Обёртки над Radix Themes: те же пропсы, что у обычных <button>, <input>, <textarea>,
 * поэтому формы со server actions продолжают работать как раньше (значения уходят в FormData).
 * Старые CSS-классы кнопок понимаются: ghost → контурная, danger → красная, small → мелкая.
 */
import { Button as RButton, Checkbox, Flex, Select, Text, TextArea as RTextArea, TextField } from "@radix-ui/themes";
import { useEffect, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";

const DROP_STYLE_KEYS = ["padding", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "border", "lineHeight", "background", "color"];
function cleanStyle(style?: CSSProperties): CSSProperties | undefined {
  if (!style) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) if (!DROP_STYLE_KEYS.includes(k)) out[k] = v;
  return out as CSSProperties;
}

/* ───────── Кнопка ───────── */
export function Button({ className = "", style, children, type, ...rest }: Omit<ComponentProps<"button">, "color">) {
  const tokens = className.split(/\s+/);
  const ghost = tokens.includes("ghost");
  const danger = tokens.includes("danger");
  const small = tokens.includes("small");
  const other = tokens.filter((t) => !["ghost", "danger", "small", ""].includes(t)).join(" ");
  return (
    <RButton
      type={type ?? "submit"}
      size={small ? "1" : "2"}
      variant={danger ? "soft" : ghost ? "outline" : "solid"}
      color={danger ? "red" : undefined}
      highContrast={false}
      className={other || undefined}
      style={{ cursor: "pointer", ...cleanStyle(style) }}
      {...(rest as object)}
    >
      {children}
    </RButton>
  );
}

/* ───────── Текстовое поле ───────── */
export function Input({ style, className, type = "text", ...rest }: Omit<ComponentProps<"input">, "size" | "color">) {
  return <TextField.Root type={type as "text"} size="2" className={className} style={{ width: "100%", ...style }} {...(rest as object)} />;
}

export function Area({ style, className, rows, ...rest }: Omit<ComponentProps<"textarea">, "color">) {
  return (
    <RTextArea
      size="2"
      resize="vertical"
      rows={rows ?? 4}
      className={className}
      style={{ width: "100%", ...style }}
      {...(rest as object)}
    />
  );
}

/* ───────── Флажок ───────── */
export function Check({
  name,
  value,
  defaultChecked,
  checked,
  onCheckedChange,
  disabled,
  children,
  inline,
}: {
  name?: string;
  value?: string;
  inline?: boolean;
  defaultChecked?: boolean;
  checked?: boolean;
  onCheckedChange?: (v: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <Text as="label" size="2" style={{ display: inline ? "inline-block" : "block", margin: inline ? 0 : "6px 0", fontWeight: 400 }}>
      <Flex gap="2" align="center">
        <Checkbox
          name={name}
          value={value}
          defaultChecked={defaultChecked}
          checked={checked}
          onCheckedChange={onCheckedChange ? (v) => onCheckedChange(v === true) : undefined}
          disabled={disabled}
        />
        {children}
      </Flex>
    </Text>
  );
}

/* ───────── Выпадающий список ─────────
 * Radix не принимает пустое значение у пункта, поэтому "" внутри подменяется служебным,
 * а в форму уходит настоящее значение через скрытое поле — серверные действия ничего не замечают. */
const EMPTY = "__empty__";

/** Radix рисует выбранное значение только после загрузки скриптов; до этого показываем его как подсказку, чтобы список не мигал пустым. */
export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}
export type Option = { value: string; label: string; disabled?: boolean };

export function Dropdown({
  name,
  options,
  defaultValue,
  value,
  onValueChange,
  placeholder,
  width = "100%",
  size = "2",
  disabled,
  ariaLabel,
}: {
  name?: string;
  options: Option[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (v: string) => void;
  placeholder?: string;
  width?: CSSProperties["width"];
  size?: "1" | "2" | "3";
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = value ?? inner;
  const mounted = useMounted();
  const toRadix = (v: string) => (v === "" ? EMPTY : v);
  return (
    <>
      {name && <input type="hidden" name={name} value={current} />}
      <Select.Root
        size={size}
        value={mounted ? toRadix(current) : ""}
        disabled={disabled}
        onValueChange={(v) => {
          // Сброс формы (после отправки) Radix сообщает «пустым» значением — возвращаем значение по умолчанию.
          const real = !v ? (defaultValue ?? options[0]?.value ?? "") : v === EMPTY ? "" : v;
          setInner(real);
          onValueChange?.(real);
        }}
      >
        <Select.Trigger
          aria-label={ariaLabel}
          placeholder={mounted ? placeholder : (options.find((o) => o.value === current)?.label ?? placeholder)}
          className={mounted ? undefined : "ssr-value"}
          style={{ width, maxWidth: "100%" }}
        />
        <Select.Content position="popper" sideOffset={4}>
          {options.map((o) => (
            <Select.Item key={o.value} value={toRadix(o.value)} disabled={o.disabled}>
              {o.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </>
  );
}
