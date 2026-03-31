import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';

export function SelectField(props: {
  label: string;
  value: string;
  items: Array<[string, string]>;
  onValueChange(value: string): void;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{props.label}</span>
      <Select value={props.value} onValueChange={props.onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder={props.label} />
        </SelectTrigger>
        <SelectContent>
          {props.items.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  placeholder?: string;
  onChange(value: string): void;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{props.label}</span>
      <Input
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

export function TextareaField(props: {
  label: string;
  value: string;
  description: string;
  placeholder?: string;
  onChange(value: string): void;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{props.label}</span>
      <Textarea
        value={props.value}
        rows={4}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <span className="text-xs text-muted">{props.description}</span>
    </label>
  );
}

export function SecretField(props: {
  label: string;
  value: string;
  hasStoredSecret: boolean;
  multiline?: boolean;
  onChange(value: string): void;
}) {
  const placeholder = props.hasStoredSecret
    ? 'Leave blank to preserve the stored secret'
    : 'Enter secret value';

  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{props.label}</span>
      {props.multiline ? (
        <Textarea
          value={props.value}
          rows={4}
          placeholder={placeholder}
          onChange={(event) => props.onChange(event.target.value)}
        />
      ) : (
        <Input
          value={props.value}
          placeholder={placeholder}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    </label>
  );
}
