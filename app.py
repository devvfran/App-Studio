import os
import json
import tempfile
import static_ffmpeg

# Setup static ffmpeg automatically before importing pydub
static_ffmpeg.add_paths()

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from pydub import AudioSegment
from fpdf import FPDF

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# Servimos los archivos estáticos (el frontend html/css/js) desde la raiz
@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/api/convert/audio', methods=['POST'])
def convert_audio():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio']
    session_name = request.form.get('sessionName', 'audio')
    
    # Create temp files
    fd_in, temp_in = tempfile.mkstemp(suffix='.webm')
    fd_out, temp_out = tempfile.mkstemp(suffix='.mp3')
    
    try:
        os.close(fd_in)
        os.close(fd_out)
        
        # Save uploaded file
        audio_file.save(temp_in)
        
        # Convert webm to mp3 using pydub
        audio = AudioSegment.from_file(temp_in, format="webm")
        audio.export(temp_out, format="mp3", bitrate="128k")
        
        filename = f"{session_name.replace(' ', '_')}_audio.mp3"
        return send_file(
            temp_out,
            mimetype='audio/mpeg',
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        print(f"Error converting audio: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        # Cleanup temp files when done if possible (or handled by OS)
        pass

class PDF(FPDF):
    def header(self):
        # Header background
        self.set_fill_color(99, 102, 241)
        self.rect(0, 0, 210, 40, 'F')
        
        # Title
        self.set_font('Helvetica', 'B', 22)
        self.set_text_color(255, 255, 255)
        self.cell(0, 15, 'NoteClass', 0, 1, 'L')
        
        self.set_font('Helvetica', '', 10)
        self.set_text_color(220, 220, 255)
        self.cell(0, 5, 'Apuntes Inteligentes', 0, 1, 'L')

    def footer(self):
        self.set_y(-15)
        self.set_font('Helvetica', 'I', 8)
        self.set_text_color(160, 160, 180)
        self.cell(0, 10, f'NoteClass - Pagina {self.page_no()}', 0, 0, 'C')

@app.route('/api/convert/notes', methods=['POST'])
def convert_notes():
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    session_name = data.get('sessionName', 'Sesion sin nombre')
    elapsed = data.get('elapsed', '00:00:00')
    word_count = data.get('wordCount', 0)
    markers = data.get('markers', 0)
    date_str = data.get('date', '')
    transcription = data.get('transcription', [])
    notes = data.get('notes', '(Sin apuntes)')

    pdf = PDF()
    pdf.add_page()
    
    # Session name (over header)
    pdf.set_y(32)
    pdf.set_font('Helvetica', 'B', 14)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(0, 5, session_name.encode('latin-1', 'replace').decode('latin-1'), 0, 1, 'L')
    
    pdf.set_y(52)

    # Metadata box
    pdf.set_draw_color(200, 200, 220)
    pdf.set_fill_color(245, 245, 250)
    pdf.rect(20, pdf.get_y(), 170, 22, 'DF')
    pdf.set_font('Helvetica', '', 9)
    pdf.set_text_color(80, 80, 100)
    
    pdf.set_y(pdf.get_y() + 6)
    pdf.set_x(25)
    pdf.cell(60, 5, f"Fecha: {date_str}".encode('latin-1', 'replace').decode('latin-1'))
    pdf.cell(50, 5, f"Duracion: {elapsed}")
    pdf.cell(50, 5, f"Palabras: {word_count}")
    
    pdf.ln()
    pdf.set_x(135) # Below words
    pdf.cell(50, 5, f"Marcadores: {markers}")
    
    pdf.set_y(90)

    # TRANSCRIPCION
    pdf.set_font('Helvetica', 'B', 14)
    pdf.set_text_color(99, 102, 241)
    pdf.cell(0, 8, 'TRANSCRIPCION', 0, 1)
    
    pdf.set_draw_color(99, 102, 241)
    pdf.line(10, pdf.get_y(), 65, pdf.get_y())
    pdf.ln(5)

    if not transcription:
        pdf.set_font('Helvetica', '', 10)
        pdf.set_text_color(150, 150, 170)
        pdf.cell(0, 5, '(Sin transcripcion)', 0, 1)
    else:
        for entry in transcription:
            pdf.set_font('Helvetica', '', 8)
            pdf.set_text_color(99, 102, 241)
            pdf.cell(0, 5, f"[{entry.get('time', '')}]", 0, 1)
            
            t_type = entry.get('type', 'normal')
            if t_type == 'marker':
                pdf.set_text_color(180, 120, 0)
            elif t_type == 'highlight':
                pdf.set_text_color(200, 50, 100)
            else:
                pdf.set_text_color(50, 50, 60)
                
            pdf.set_font('Helvetica', '', 10)
            
            # Clean emojis and encode to latin-1
            text = entry.get('text', '')
            clean_text = text.encode('latin-1', 'replace').decode('latin-1')
            
            pdf.multi_cell(0, 5, clean_text)
            pdf.ln(2)

    pdf.ln(5)

    # APUNTES
    pdf.set_font('Helvetica', 'B', 14)
    pdf.set_text_color(236, 72, 153)
    pdf.cell(0, 8, 'APUNTES', 0, 1)
    
    pdf.set_draw_color(236, 72, 153)
    pdf.line(10, pdf.get_y(), 40, pdf.get_y())
    pdf.ln(5)

    pdf.set_font('Helvetica', '', 10)
    pdf.set_text_color(50, 50, 60)
    
    notes_clean = notes.encode('latin-1', 'replace').decode('latin-1')
    pdf.multi_cell(0, 5, notes_clean)

    # Output to temp file
    fd, temp_pdf = tempfile.mkstemp(suffix='.pdf')
    os.close(fd)
    
    try:
        pdf.output(temp_pdf)
        filename = f"{session_name.replace(' ', '_')}_apuntes.pdf"
        return send_file(
            temp_pdf,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        print(f"Error generating PDF: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("Iniciando NoteClass Backend en http://localhost:5000")
    app.run(port=5000, debug=True)
