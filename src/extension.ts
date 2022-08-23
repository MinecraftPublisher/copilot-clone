import * as vscode from 'vscode';

import { search } from './utils/search';
import { matchSearchPhrase } from './utils/matchSearchPhrase';
import { getConfig } from './config';
import Parsers from './utils/parsers/index';
import ParserAbstract from './utils/parsers/ParserAbstract';
import *  as fs from 'fs';
import *  as path from 'path';
import * as os from 'os';
import fetch from 'node-fetch';

let runningParsers = false;
let cancelEvent = false;
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'captainstack-'));
let externalParsers : Promise<ParserAbstract>[] = getConfig().settings.externalParsers.map(async (e) => {
    const contents = await fetch(e).then((res) => res.text());
    const name = e.split('.')[e.split('.').length - 2];
    const filePath = path.join(tempDirectory, name) + '.ts';

    fs.writeFileSync(filePath, contents);
    return await import(filePath);
});

export function activate(_: vscode.ExtensionContext) {

    const provider: vscode.CompletionItemProvider = {
        // @ts-ignore
        provideInlineCompletionItems: async (document : vscode.TextDocument, position, context, token) => {

            const textBeforeCursor = document.getText(
                new vscode.Range(position.with(undefined, 0), position)
            );

            const match = matchSearchPhrase(textBeforeCursor);
            let items: any[] = [];

            if (match) {
                let rs;
                try {
                    rs = await search(match.searchPhrase);
                    if (rs) {
                        items = rs.results.map(item => {
                            const output = `\n${match.commentSyntax} Source: ${item.sourceURL} ${match.commentSyntaxEnd}\n${item.code}`;
                            return {
                                text: output,
                                insertText: output,
                                range: new vscode.Range(position.translate(0, output.length), position)
                            };
                        });
                    }
                } catch (err: any) {
                    vscode.window.showErrorMessage(err.toString());
                }
            } else {
                /* check if parsers are enabled */
                if(getConfig().settings.enableParsers) {
                    if(runningParsers) cancelEvent = true;

                    await new Promise((resolve, reject) =>{
                        setInterval(() => {
                            if(externalParsers.filter(e => typeof e === 'string').length !== 0) resolve(null);
                        }, 100);
                    });

                    runningParsers = true;
                    /* result has to be determined using parsers. */
                    const parserText = document.getText(
                        new vscode.Range(position.with(0, 0), position)
                    );

                    /* find enabled parsers and ask them for a result! */
                    [...Parsers, ...(await Promise.all(externalParsers))].filter((parser) => parser.isEnabled())
                    .forEach(async (parser) => {

                        parser.provideInlineCodeCompletions(
                            parserText,
                            document.fileName,
                            getConfig().settings.huggingfaceToken
                        ).then((result) => {
                            items.push({
                                text: result,
                                insertText: result,
                                range: new vscode.Range(position.translate(0, result.length), position)
                            });
                        });
                        
                        return await new Promise((resolve, reject) => {
                            setInterval(() => {
                                if(cancelEvent) resolve();
                            }, 100);
                        });
                    });

                    cancelEvent = false;
                    await new Promise((resolve, reject) => {
                        let iterations = 0;
                        setInterval(() => {
                            if(cancelEvent) reject(null);

                            iterations++;
                            if(items.length === Parsers.length) resolve(null);
                            else if (iterations > (5 * 10)) resolve(null);
                        }, 100);
                    });

                    runningParsers = false;
                }
            }

            return {items};
        },
    };

    // @ts-ignore
    vscode.languages.registerInlineCompletionItemProvider({pattern: "**"}, provider);
}
