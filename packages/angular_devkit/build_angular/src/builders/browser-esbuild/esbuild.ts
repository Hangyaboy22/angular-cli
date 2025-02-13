/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import { BuilderContext } from '@angular-devkit/architect';
import {
  BuildFailure,
  BuildInvalidate,
  BuildOptions,
  BuildResult,
  OutputFile,
  PartialMessage,
  build,
  formatMessages,
} from 'esbuild';
import { basename, extname, relative } from 'node:path';
import { FileInfo } from '../../utils/index-file/augment-index-html';

/**
 * Determines if an unknown value is an esbuild BuildFailure error object thrown by esbuild.
 * @param value A potential esbuild BuildFailure error object.
 * @returns `true` if the object is determined to be a BuildFailure object; otherwise, `false`.
 */
export function isEsBuildFailure(value: unknown): value is BuildFailure {
  return !!value && typeof value === 'object' && 'errors' in value && 'warnings' in value;
}

/**
 * Executes the esbuild build function and normalizes the build result in the event of a
 * build failure that results in no output being generated.
 * All builds use the `write` option with a value of `false` to allow for the output files
 * build result array to be populated.
 *
 * @param optionsOrInvalidate The esbuild options object to use when building or the invalidate object
 * returned from an incremental build to perform an additional incremental build.
 * @returns If output files are generated, the full esbuild BuildResult; if not, the
 * warnings and errors for the attempted build.
 */
export async function bundle(
  workspaceRoot: string,
  optionsOrInvalidate: BuildOptions | BuildInvalidate,
): Promise<
  | (BuildResult & { outputFiles: OutputFile[]; initialFiles: FileInfo[] })
  | (BuildFailure & { outputFiles?: never })
> {
  let result;
  try {
    if (typeof optionsOrInvalidate === 'function') {
      result = (await optionsOrInvalidate()) as BuildResult & { outputFiles: OutputFile[] };
    } else {
      result = await build({
        ...optionsOrInvalidate,
        metafile: true,
        write: false,
      });
    }
  } catch (failure) {
    // Build failures will throw an exception which contains errors/warnings
    if (isEsBuildFailure(failure)) {
      return failure;
    } else {
      throw failure;
    }
  }

  const initialFiles: FileInfo[] = [];
  for (const outputFile of result.outputFiles) {
    // Entries in the metafile are relative to the `absWorkingDir` option which is set to the workspaceRoot
    const relativeFilePath = relative(workspaceRoot, outputFile.path);
    const entryPoint = result.metafile?.outputs[relativeFilePath]?.entryPoint;

    outputFile.path = relativeFilePath;

    if (entryPoint) {
      // An entryPoint value indicates an initial file
      initialFiles.push({
        file: outputFile.path,
        // The first part of the filename is the name of file (e.g., "polyfills" for "polyfills.7S5G3MDY.js")
        name: basename(outputFile.path).split('.')[0],
        extension: extname(outputFile.path),
      });
    }
  }

  return { ...result, initialFiles };
}

export async function logMessages(
  context: BuilderContext,
  { errors, warnings }: { errors: PartialMessage[]; warnings: PartialMessage[] },
): Promise<void> {
  if (warnings.length) {
    const warningMessages = await formatMessages(warnings, { kind: 'warning', color: true });
    context.logger.warn(warningMessages.join('\n'));
  }

  if (errors.length) {
    const errorMessages = await formatMessages(errors, { kind: 'error', color: true });
    context.logger.error(errorMessages.join('\n'));
  }
}
