import { Input } from '../ui/input.js';

export function ImageReferenceField(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  suggestions?: string[];
  helperText?: string;
  error?: string;
  listId?: string;
  disabled?: boolean;
}): JSX.Element {
  const listId =
    props.suggestions && props.suggestions.length > 0
      ? props.listId ?? 'image-reference-suggestions'
      : undefined;

  return (
    <div className="space-y-2">
      <Input
        list={listId}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        aria-invalid={props.error ? 'true' : 'false'}
        disabled={props.disabled}
      />
      {listId ? (
        <datalist id={listId}>
          {props.suggestions?.map((image) => (
            <option key={image} value={image} />
          ))}
        </datalist>
      ) : null}
      {props.error ? <p className="text-xs text-red-600">{props.error}</p> : null}
      {!props.error && props.helperText ? <p className="text-xs text-muted">{props.helperText}</p> : null}
    </div>
  );
}
