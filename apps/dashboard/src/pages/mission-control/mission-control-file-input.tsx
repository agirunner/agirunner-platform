import { Trash2, Upload } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';

export function MissionControlFileInput(props: {
  files: File[];
  onChange(files: File[]): void;
  label: string;
  description: string;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-md border border-dashed border-border p-4">
      <div className="grid gap-1">
        <strong className="text-sm">{props.label}</strong>
        <p className="text-sm text-muted-foreground">{props.description}</p>
      </div>
      <Input
        type="file"
        multiple
        onChange={(event) => {
          const nextFiles = Array.from(event.target.files ?? []);
          props.onChange(nextFiles);
          event.target.value = '';
        }}
      />
      {props.files.length > 0 ? (
        <ul className="grid gap-2 text-sm">
          {props.files.map((file) => (
            <li
              key={`${file.name}:${file.lastModified}:${file.size}`}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <span className="truncate">{file.name}</span>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() =>
                  props.onChange(
                    props.files.filter(
                      (entry) =>
                        !(
                          entry.name === file.name
                          && entry.lastModified === file.lastModified
                          && entry.size === file.size
                        ),
                    ),
                  )
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Upload className="h-4 w-4" />
          No files selected.
        </div>
      )}
    </div>
  );
}
