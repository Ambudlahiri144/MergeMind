import type { PullRequestFile } from '@mergemind/github';

// Fixture diffs are plain `git diff` output. GitHub's API hands the pipeline one patch per
// file, so this splits a multi-file diff into the same `PullRequestFile` shape.

const FILE_HEADER = /^diff --git a\/(.+) b\/(.+)$/;

type Draft = {
  oldPath: string;
  newPath: string;
  status: string;
  patchLines: string[];
  isInHunks: boolean;
};

function finish(draft: Draft): PullRequestFile {
  const patch = draft.patchLines.join('\n');
  const additions = draft.patchLines.filter((line) => line.startsWith('+')).length;
  const deletions = draft.patchLines.filter((line) => line.startsWith('-')).length;
  return {
    filename: draft.newPath,
    ...(draft.status === 'renamed' ? { previous_filename: draft.oldPath } : {}),
    status: draft.status,
    additions,
    deletions,
    ...(patch === '' ? {} : { patch }),
  };
}

/** `git diff` text -> one `PullRequestFile` per `diff --git` section, in order. */
export function splitUnifiedDiff(text: string): PullRequestFile[] {
  const files: PullRequestFile[] = [];
  let draft: Draft | null = null;

  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const header = FILE_HEADER.exec(line);
    if (header) {
      if (draft) {
        files.push(finish(draft));
      }
      draft = {
        oldPath: header[1] ?? '',
        newPath: header[2] ?? '',
        status: 'modified',
        patchLines: [],
        isInHunks: false,
      };
      continue;
    }
    if (!draft) {
      continue;
    }
    if (!draft.isInHunks) {
      if (line.startsWith('new file mode')) {
        draft.status = 'added';
      } else if (line.startsWith('deleted file mode')) {
        draft.status = 'removed';
      } else if (line.startsWith('rename from ')) {
        draft.status = 'renamed';
      } else if (line.startsWith('@@')) {
        draft.isInHunks = true;
        draft.patchLines.push(line);
      }
      continue;
    }
    draft.patchLines.push(line);
  }
  if (draft) {
    files.push(finish(draft));
  }
  // A trailing newline in the file leaves an empty last line: drop it from each patch.
  return files.map((file) =>
    file.patch === undefined ? file : { ...file, patch: file.patch.replace(/\n+$/, '') },
  );
}
