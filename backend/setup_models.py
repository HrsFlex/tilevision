"""
Download SAM 2.1 model checkpoint from HuggingFace.
Run: python setup_models.py
"""


def main():
    print("Downloading SAM 2.1 hiera-tiny model...")
    print("This will download ~150MB from HuggingFace.\n")

    try:
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        predictor = SAM2ImagePredictor.from_pretrained("facebook/sam2.1-hiera-tiny")
        print("\nSAM 2.1 model downloaded and verified successfully!")
        print("The model will be cached in your HuggingFace cache directory.")
    except ImportError:
        print("ERROR: sam2 package not found.")
        print("Install it with:")
        print("  pip install git+https://github.com/facebookresearch/sam2.git")
    except Exception as e:
        print(f"ERROR: {e}")
        print("\nMake sure you have:")
        print("  1. pip install torch torchvision")
        print("  2. pip install git+https://github.com/facebookresearch/sam2.git")


if __name__ == "__main__":
    main()
