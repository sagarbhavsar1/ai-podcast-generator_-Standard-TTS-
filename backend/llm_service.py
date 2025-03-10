import sys
import json
import re

def clean_text(text):
    """Clean and prepare the extracted text for better processing."""
    # Remove excessive whitespace
    text = re.sub(r'\s+', ' ', text)
    # Remove page numbers and headers/footers (common in PDFs)
    text = re.sub(r'\b\d+\s*of\s*\d+\b', '', text)
    return text.strip()

def extract_key_points(text, max_points=5):
    """Extract key points from the text."""
    # Simple extraction - split by periods and take first sentences
    sentences = text.split('.')
    key_points = []

    for sentence in sentences:
        if len(sentence.strip()) > 20:  # Only consider substantial sentences
            key_points.append(sentence.strip())
            if len(key_points) >= max_points:
                break

    return key_points

def generate_podcast_script(pdf_text):
    """Generate a natural podcast conversation based on PDF content."""
    # Clean and prepare the text
    cleaned_text = clean_text(pdf_text)

    # Extract key points from the text
    key_points = extract_key_points(cleaned_text)

    # For a real implementation, you would use an actual LLM here
    # This is a more sophisticated mock implementation

    # Create an introduction
    intro = """
Host A: Welcome to today's episode! I'm excited to dive into this fascinating document we found.
Host B: Me too! I've been looking through it, and there are some really interesting points to discuss.
Host A: Before we get into the details, can you give our listeners a quick overview of what this document is about?
Host B: Sure thing! This document appears to be about {}. It covers several key topics that I think our audience will find valuable.
""".format(key_points[0] if key_points else "an interesting topic")

    # Create the main discussion
    discussion = ""
    for i, point in enumerate(key_points):
        if i % 2 == 0:
            discussion += f"\nHost A: One thing that caught my attention was this point: '{point}'. What do you think about that?\n"
            discussion += f"Host B: That's fascinating! I think it relates to the broader context of the document. It suggests that there's a deeper meaning here.\n"
        else:
            discussion += f"\nHost B: Another interesting aspect is '{point}'. Did you notice how that connects to what we discussed earlier?\n"
            discussion += f"Host A: Absolutely! It builds on those ideas and takes them in a new direction. I particularly like how it emphasizes the practical implications.\n"

    # Create a conclusion
    conclusion = """
Host A: Before we wrap up, what's your main takeaway from this document?
Host B: I'd say the most important insight is how interconnected all these points are. It presents a comprehensive view of the subject.
Host A: Great observation! And for our listeners who want to learn more, we recommend checking out the full document.
Host B: Definitely. Thanks for joining us today on this exploration!
Host A: Until next time, keep learning and stay curious!
"""

    # Combine all parts
    full_script = intro + discussion + conclusion

    return full_script

if __name__ == "__main__":
    # Read input from stdin
    pdf_text = sys.stdin.read()
    script = generate_podcast_script(pdf_text)
    # Output only JSON
    print(json.dumps({"script": script}))
