"""Create a localhost-only certificate for the USB development connection."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
import ipaddress
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
out=Path(__file__).resolve().parent/'.local'
out.mkdir(exist_ok=True)
if not (out/'localhost.crt').exists():
 key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
 subject=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Forest USB Development')])
 now=datetime.now(timezone.utc)
 cert=(x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
  .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=90))
  .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False)
  .add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True).sign(key,hashes.SHA256()))
 (out/'localhost.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
 (out/'localhost.crt').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
print('Local USB TLS certificate ready; private key stays on this computer.')
