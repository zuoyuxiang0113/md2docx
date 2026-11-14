// In an Artifact Tool environment, import the complete editable model.
import fs from 'node:fs/promises';
import { Presentation, PresentationFile } from '@oai/artifact-tool';
const data=JSON.parse(await fs.readFile(new URL('./presentation-model.json',import.meta.url),'utf8'));
const deck=await Presentation.load(data);
await (await PresentationFile.exportPptx(deck)).save('md2docx-rebuilt.pptx');
