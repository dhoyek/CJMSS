import PyPDF2, sys
from pathlib import Path
p = Path(r"src/CJMSS.WebResources/Documentation/stock.pdf")
reader = PyPDF2.PdfReader(str(p))
print(len(reader.pages))
print('---')
text = []
for i,pg in enumerate(reader.pages[:5]):
    t = pg.extract_text() or ''
    print(f'[[PAGE {i+1}]]')
    print(t[:3000])
    print('===')
