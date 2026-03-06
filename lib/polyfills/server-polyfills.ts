/**
 * Server-Side Polyfills
 * 
 * This module provides polyfills for browser APIs that are not available
 * in Node.js server environment, preventing build-time errors.
 */

// Polyfill for DOMMatrix (used by some PDF processing libraries)
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    m11 = 1;
    m12 = 0;
    m13 = 0;
    m14 = 0;
    m21 = 0;
    m22 = 1;
    m23 = 0;
    m24 = 0;
    m31 = 0;
    m32 = 0;
    m33 = 1;
    m34 = 0;
    m41 = 0;
    m42 = 0;
    m43 = 0;
    m44 = 1;
    is2D = true;
    isIdentity = true;

    constructor(init?: string | number[]) {
      if (init) {
        if (typeof init === 'string') {
          // Parse CSS transform matrix string
          const values = init.match(/-?[\d.]+/g);
          if (values && values.length >= 6) {
            this.a = parseFloat(values[0]);
            this.b = parseFloat(values[1]);
            this.c = parseFloat(values[2]);
            this.d = parseFloat(values[3]);
            this.e = parseFloat(values[4]);
            this.f = parseFloat(values[5]);
            this.isIdentity = false;
          }
        } else if (Array.isArray(init)) {
          // Parse array of values
          if (init.length >= 6) {
            this.a = init[0];
            this.b = init[1];
            this.c = init[2];
            this.d = init[3];
            this.e = init[4];
            this.f = init[5];
            this.isIdentity = false;
          }
        }
      }
    }

    translate(tx: number, ty: number) {
      return new DOMMatrix([this.a, this.b, this.c, this.d, this.e + tx, this.f + ty]);
    }

    scale(sx: number, sy: number = sx) {
      return new DOMMatrix([this.a * sx, this.b * sx, this.c * sy, this.d * sy, this.e, this.f]);
    }

    rotate(angle: number) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return new DOMMatrix([
        this.a * cos - this.b * sin,
        this.a * sin + this.b * cos,
        this.c * cos - this.d * sin,
        this.c * sin + this.d * cos,
        this.e,
        this.f
      ]);
    }

    multiply(other: DOMMatrix) {
      return new DOMMatrix([
        this.a * other.a + this.c * other.b,
        this.b * other.a + this.d * other.b,
        this.a * other.c + this.c * other.d,
        this.b * other.c + this.d * other.d,
        this.a * other.e + this.c * other.f + this.e,
        this.b * other.e + this.d * other.f + this.f
      ]);
    }

    inverse() {
      const det = this.a * this.d - this.b * this.c;
      if (Math.abs(det) < 1e-10) {
        throw new Error('Matrix is not invertible');
      }
      return new DOMMatrix([
        this.d / det,
        -this.b / det,
        -this.c / det,
        this.a / det,
        (this.c * this.f - this.d * this.e) / det,
        (this.b * this.e - this.a * this.f) / det
      ]);
    }

    transformPoint(point: { x: number; y: number }) {
      return {
        x: this.a * point.x + this.c * point.y + this.e,
        y: this.b * point.x + this.d * point.y + this.f
      };
    }

    toString() {
      return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
    }
  } as any;
}

// Polyfill for URL.createObjectURL (used by file handling)
if (typeof globalThis.URL === 'undefined' || !globalThis.URL.createObjectURL) {
  if (typeof globalThis.URL === 'undefined') {
    globalThis.URL = {} as any;
  }
  globalThis.URL.createObjectURL = (blob: any) => {
    return `blob:mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };
  globalThis.URL.revokeObjectURL = (url: string) => {
    // Mock implementation - no-op
  };
}

// Polyfill for FileReader (used by file processing)
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    result: string | ArrayBuffer | null = null;
    error: Error | null = null;
    readyState: number = 0;
    onload: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    onloadend: ((event: any) => void) | null = null;

    readAsText(blob: any) {
      setTimeout(() => {
        this.result = 'mock file content';
        this.readyState = 2;
        if (this.onload) {
          this.onload({ target: this });
        }
        if (this.onloadend) {
          this.onloadend({ target: this });
        }
      }, 0);
    }

    readAsArrayBuffer(blob: any) {
      setTimeout(() => {
        this.result = new ArrayBuffer(0);
        this.readyState = 2;
        if (this.onload) {
          this.onload({ target: this });
        }
        if (this.onloadend) {
          this.onloadend({ target: this });
        }
      }, 0);
    }

    readAsDataURL(blob: any) {
      setTimeout(() => {
        this.result = 'data:text/plain;base64,bW9jayBmaWxlIGNvbnRlbnQ=';
        this.readyState = 2;
        if (this.onload) {
          this.onload({ target: this });
        }
        if (this.onloadend) {
          this.onloadend({ target: this });
        }
      }, 0);
    }

    abort() {
      this.readyState = 2;
      this.error = new Error('Aborted');
      if (this.onerror) {
        this.onerror({ target: this });
      }
      if (this.onloadend) {
        this.onloadend({ target: this });
      }
    }
  } as any;
}

// Polyfill for Blob (used by file handling)
if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = class Blob {
    size: number = 0;
    type: string = '';

    constructor(chunks: any[] = [], options: any = {}) {
      this.type = options.type || '';
      this.size = chunks.reduce((acc, chunk) => acc + (chunk.length || 0), 0);
    }

    slice(start: number = 0, end?: number, contentType?: string) {
      return new Blob([], { type: contentType || this.type });
    }

    stream() {
      return new ReadableStream();
    }

    text() {
      return Promise.resolve('mock blob content');
    }

    arrayBuffer() {
      return Promise.resolve(new ArrayBuffer(0));
    }
  } as any;
}

// Polyfill for File (used by file handling)
if (typeof globalThis.File === 'undefined') {
  globalThis.File = class File extends Blob {
    name: string = '';
    lastModified: number = Date.now();

    constructor(chunks: any[] = [], filename: string, options: any = {}) {
      super(chunks, options);
      this.name = filename;
      this.lastModified = options.lastModified || Date.now();
    }
  } as any;
}

// Polyfill for FormData (used by file uploads)
if (typeof globalThis.FormData === 'undefined') {
  globalThis.FormData = class FormData {
    private data = new Map<string, any>();

    append(name: string, value: any, filename?: string) {
      this.data.set(name, { value, filename });
    }

    delete(name: string) {
      this.data.delete(name);
    }

    get(name: string) {
      const item = this.data.get(name);
      return item ? item.value : null;
    }

    getAll(name: string) {
      const items = Array.from(this.data.entries())
        .filter(([key]) => key === name)
        .map(([, item]) => item.value);
      return items;
    }

    has(name: string) {
      return this.data.has(name);
    }

    set(name: string, value: any, filename?: string) {
      this.data.set(name, { value, filename });
    }

    forEach(callback: (value: any, key: string, parent: FormData) => void) {
      this.data.forEach((item, key) => callback(item.value, key, this));
    }

    entries() {
      return Array.from(this.data.entries()).map(([key, item]) => [key, item.value]);
    }

    keys() {
      return this.data.keys();
    }

    values() {
      return Array.from(this.data.values()).map(item => item.value);
    }
  } as any;
}

// Polyfill for ReadableStream (used by file processing)
if (typeof globalThis.ReadableStream === 'undefined') {
  globalThis.ReadableStream = class ReadableStream {
    constructor(underlyingSource?: any, strategy?: any) {
      // Mock implementation
    }

    getReader() {
      return {
        read() {
          return Promise.resolve({ done: true, value: undefined });
        },
        releaseLock() {
          // Mock implementation
        }
      };
    }

    pipeTo(destination: any) {
      return Promise.resolve();
    }

    pipeThrough(transform: any) {
      return this;
    }

    cancel(reason?: any) {
      return Promise.resolve();
    }

    tee() {
      return [this, this];
    }
  } as any;
}

// Polyfill for TextEncoder/TextDecoder (used by text processing)
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = class TextEncoder {
    encode(input: string) {
      return new Uint8Array(Buffer.from(input, 'utf8'));
    }
  } as any;
}

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = class TextDecoder {
    decode(input: Uint8Array) {
      return Buffer.from(input).toString('utf8');
    }
  } as any;
}

// Polyfill for document object (used by styled-jsx and DOM libraries)
// CRITICAL: Must be created BEFORE styled-jsx is imported
if (typeof globalThis.document === 'undefined') {
  const mockElement = {
    appendChild: () => {},
    insertBefore: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    removeAttribute: () => {},
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    style: {},
    innerText: '',
    innerHTML: '',
    textContent: '',
  };

  globalThis.document = {
    createElement: () => mockElement,
    createTextNode: () => ({}),
    head: mockElement,
    body: mockElement,
    documentElement: { ...mockElement, className: '' },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementsByClassName: () => [],
    getElementsByTagName: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { href: 'http://localhost:3000' },
    createComment: () => ({}),
    readyState: 'complete',
  } as any;
}

// Export the polyfills to ensure they're loaded
export const serverPolyfills = {
  DOMMatrix: globalThis.DOMMatrix,
  URL: globalThis.URL,
  FileReader: globalThis.FileReader,
  Blob: globalThis.Blob,
  File: globalThis.File,
  FormData: globalThis.FormData,
  ReadableStream: globalThis.ReadableStream,
  TextEncoder: globalThis.TextEncoder,
  TextDecoder: globalThis.TextDecoder,
  document: globalThis.document,
};
