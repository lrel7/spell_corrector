import { Plugin, Editor, EditorPosition, Notice } from 'obsidian';
import { keymap } from '@codemirror/view'
import { Extension, Prec } from '@codemirror/state';
import * as fs from 'fs';

class SpellChecker {
	private dictWords: string[];
	private wordCount: Map<string, number> = new Map();
	private totalCount: number = 0;
	private wordProbs: Map<string, number> = new Map();

	constructor(dictWords: string[]) {
		this.dictWords = dictWords;
		dictWords.forEach((word) => {
			const lowercaseWord = word.toLowerCase();
			this.wordCount.set(lowercaseWord, (this.wordCount.get(lowercaseWord) || 0) + 1);
		});
		this.totalCount = [...this.wordCount.values()].reduce((sum, count) => sum + count, 0);
		this.wordProbs = new Map(
			[...this.wordCount.entries()].map(([word, count]) => [word, count / this.totalCount])
		);
	}

	edit1(word: string) {
		const letters = 'abcdefghijklmnopqrstuvwxyz';
		const splits = Array.from({ length: word.length + 1 }, (_, i) => [word.slice(0, i), word.slice(i)]);
		const deletes = splits.filter(([, r]) => r.length > 0).map(([l, r]) => l + r.slice(1));
		const swaps = splits.filter(([, r]) => r.length > 1).map(([l, r]) => l + r[1] + r[0] + r.slice(2));
		const replaces = splits
			.filter(([, r]) => r.length > 0)
			.map(([l, r]) => letters.split('').map((c) => l + c + r.slice(1)))
			.flat();
		const inserts = splits
			.map(([l, r]) => letters.split('').map((c) => l + c + r))
			.flat();
		return new Set([...deletes, ...swaps, ...replaces, ...inserts]);
	}

	edit2(word: string) {
		return new Set(
			Array.from(this.edit1(word)).map((e1) => Array.from(this.edit1(e1))).flat()
		);
	}


	check(word: string): string {
		let word_ = word.toLowerCase();
		if (this.dictWords.includes(word_)) {
			return word;
		}
		const candidates = this.edit1(word_).size
			? this.edit1(word_)
			: this.edit2(word_).size
				? this.edit2(word_)
				: new Set([word_]);
		const validCandidates = [...candidates].filter((w) => this.dictWords.includes(w));
		return [...validCandidates]
			.map((c) => [c, this.wordProbs.get(c) || 0])
			.sort((a, b) => Number(b[1]) - Number(a[1]))
			.values().next().value[0];
	}
}

export default class MyPlugin extends Plugin {
	private currentWord: string = '';
	private replacement: string | undefined = undefined;
	private oldWord: string = '';
	private dictPath = 'E:\\笔记\\.obsidian\\plugins\\spell_corrector\\dict.txt';
	private dictWords: string[];
	private spellChecker: SpellChecker | null = null;
	private flag: boolean = false;

	private printCurrentWord = (): Extension => Prec.high(keymap.of([
		{
			key: 'Space',
			run: (): boolean => {
				this.replacement = this.spellChecker?.check(this.currentWord);
				if (this.replacement && this.replacement === this.currentWord) {
					return false;
				}
				console.log(this.replacement);
				const editor = this.app.workspace.activeEditor?.editor;
				if (editor) {
					this.replaceWrongWord(editor);
				}
				this.flag = true;
				return false;
			}
		},
		{
			key: 'Tab',
			run: (): boolean => {
				if (this.flag === false) {
					return false;
				}
				const editor = this.app.workspace.activeEditor?.editor;
				if (editor) {
					this.undoReplacement(editor);
				}
				return true;
			}
		},
		{
			key: '',
			run: (): boolean => {
				this.flag = false;
				return false;
			}
		}
	]))

	private loadDict(filepath: string): void {
		try {
			const content = fs.readFileSync(filepath, 'utf-8');
			this.dictWords = content.trim().split('\r\n');
		}
		catch (error) {
			console.error('Error reading from file:', error);
			this.dictWords = [];
		}
	}

	private replaceWrongWord(editor: Editor) {
		if (this.replacement && this.currentWord) {
			const cursor = editor.getCursor();
			const from: EditorPosition = { line: cursor.line, ch: cursor.ch - this.currentWord.length };
			const to: EditorPosition = { line: cursor.line, ch: cursor.ch };
			this.oldWord = this.currentWord;
			editor.replaceRange(this.replacement, from, to);
			new Notice("Replaced " + "\'" + this.oldWord + "\'" + " with " + "\'" + this.replacement + "\'");
		}
	}

	private undoReplacement(editor: Editor) {
		if (this.replacement && this.oldWord) {
			const cursor = editor.getCursor();
			const from: EditorPosition = { line: cursor.line, ch: cursor.ch - this.replacement.length - 1 };
			const to: EditorPosition = { line: cursor.line, ch: cursor.ch -1 };
			editor.replaceRange(this.oldWord, from, to);
			new Notice("Undo replacement!");
		}
	}

	getCurrentWord(editor: Editor) {
		// Your code to handle cursor activity and get the current word
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const wordRegex = /[\w]+/g;
		const wordsInLine = line.match(wordRegex) || [];
		const currentWord = wordsInLine.find((word) => {
			const wordStart = line.lastIndexOf(word, cursor.ch);
			const wordEnd = wordStart + word.length;
			return cursor.ch >= wordStart && cursor.ch <= wordEnd;
		});
		if (currentWord) {
			this.currentWord = currentWord;
		}
	}

	async onload() {
		console.log(process.cwd());
		this.loadDict(this.dictPath);
		this.spellChecker = new SpellChecker(this.dictWords);
		this.registerEditorExtension(this.printCurrentWord());
		this.registerEvent(this.app.workspace.on("editor-change", this.getCurrentWord.bind(this)));
	}
}
