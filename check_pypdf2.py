import importlib
try:
    import PyPDF2
    print('OK')
except Exception as e:
    print('NO')
