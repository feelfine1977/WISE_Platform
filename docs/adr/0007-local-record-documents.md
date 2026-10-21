# 0007 — Local record documents: size limit, attachment types and reference computer

Status: **proposed** — taken by the implementing agent for #132 while the owner was away (instructed to decide without the owner); the owner may confirm or change it. A change is a contract change of `record-documents.schema.json` and the service constants it names.

## Context

#132 lets the analyst read the email, note or object card behind a record from a document folder on this computer, written by the work side's masking step (cooperation decision 0005, thread 009). The ticket requires a *stated* size limit and a *stated* list of attachment types named in the versioned contract, and a performance bound "on the reference computer", without fixing their values.

## Decision

1. **Size limit: 1 MiB (1,048,576 bytes) per document file.** A masked email, note or object card is text; one mebibyte holds several hundred pages of plain text, far above an ordinary message, while keeping one read well inside the one-second bound. A larger file is refused as "too large to show" with its size and is never truncated; a document the work side cut itself carries its own `cut` marker.
2. **Attachment types the platform may ask the system to open:** PDF, PNG, JPEG, GIF, plain text, Word/Excel/PowerPoint (`docx`, `xlsx`, `pptx`, `doc`, `xls`, `ppt`) and OpenDocument (`odt`, `ods`, `odp`). Each is checked by its extension, its declared media type and its content signature together. Macro-enabled Office formats, HTML/SVG, programs, scripts, shortcuts and archives are never on the list. Opening is always a deliberate click, asking the operating system to use its default program (`open` on macOS, the registered default on Windows); other systems answer "unsupported system".
3. **Reference computer: the development Mac used for qualification** (Apple silicon, 64 GB memory, macOS 26). The qualifier `tools/qualify_record_documents.py` records the measured time to show the largest allowed document in the built browser.
4. **Origin rule:** the document and folder routes answer only the platform's own loopback host and origin. A development server is trusted only when named in `WISE_TRUSTED_WEB_ORIGINS` (loopback `http` origins only).

## Consequences

- The limits are named once in the contract (`MaxDocumentBytes`, `OpenableAttachmentType`) and tested to equal the service constants.
- Nothing of a document is stored, exported or logged; only the folder is kept, with the workspace on this computer.
