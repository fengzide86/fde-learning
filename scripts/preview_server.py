"""Local-only static preview with byte ranges for real video seeking."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from pathlib import Path
import os, re, argparse

parser=argparse.ArgumentParser(description='Preview the static learning site with video byte ranges.')
parser.add_argument('--port',type=int,default=8080)
parser.add_argument('--mount',default='/',help='Optional project prefix, for example /fde-learning/')
args=parser.parse_args()
MOUNT='/'+args.mount.strip('/')+'/' if args.mount.strip('/') else '/'
SITE=Path(__file__).resolve().parents[1]/'site'
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self,path):
        if MOUNT!='/' and path.startswith(MOUNT):path='/'+path[len(MOUNT):]
        return super().translate_path(path)
    def send_head(self):
        self.remaining=None
        path=Path(self.translate_path(self.path)).resolve()
        if not path.is_relative_to(SITE.resolve()):
            self.send_error(403);return None
        if path.is_dir():return super().send_head()
        try:
            f=path.open('rb');size=os.fstat(f.fileno()).st_size
        except OSError:
            self.send_error(404);return None
        value=self.headers.get('Range')
        start,end=0,size-1
        if value:
            match=re.fullmatch(r'bytes=(\d*)-(\d*)',value.strip())
            if not match or not any(match.groups()):
                f.close();self.send_error(416);return None
            if match[1]:
                start=int(match[1]);end=min(int(match[2]) if match[2] else end,end)
            else:start=max(0,size-int(match[2]))
            if start>=size or end<start:
                f.close();self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.end_headers();return None
        self.send_response(206 if value else 200)
        self.send_header('Content-Type',self.guess_type(str(path)))
        self.send_header('Accept-Ranges','bytes')
        self.send_header('Content-Length',str(end-start+1))
        self.send_header('Cache-Control','no-cache')
        if value:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        self.end_headers();f.seek(start);self.remaining=end-start+1
        return f
    def copyfile(self, source, output):
        if self.remaining is None:return super().copyfile(source,output)
        try:
            while self.remaining:
                chunk=source.read(min(65536,self.remaining))
                if not chunk:break
                output.write(chunk);self.remaining-=len(chunk)
        except (BrokenPipeError,ConnectionResetError):pass

if __name__=='__main__':
    print(f'Preview: http://127.0.0.1:{args.port}{MOUNT}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),partial(Handler,directory=str(SITE))).serve_forever()
