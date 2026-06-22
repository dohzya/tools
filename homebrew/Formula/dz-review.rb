class DzReview < Formula
  desc "Markdown review syntax scanner and helper CLI"
  homepage "https://github.com/dohzya/tools"
  version "0.2.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.2.1/dz-review-darwin-arm64"
      sha256 "7dacd416ee7bcc924e7e1027bbe7c50913cc910faa39488d49269b7ca27ffbb6"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.2.1/dz-review-darwin-x86_64"
      sha256 "eac5b8015a240fab28da3e3e4803352ffabe73475239756f16b832facb60ead2"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.2.1/dz-review-linux-arm64"
      sha256 "07ee8e90e3069e48fde08b5a150d425a2a0a7a13bac998451f92a19d86246e1b"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.2.1/dz-review-linux-x86_64"
      sha256 "9520395a0cde72211feae8f27b89f6f04ee07dad003c44bcb7269a26250dc2aa"
    end
  end

  def install
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "dz-review-darwin-arm64"
      else
        "dz-review-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "dz-review-linux-arm64"
      else
        "dz-review-linux-x86_64"
      end
    end

    bin.install binary_name => "dz-review"
  end

  test do
    system "#{bin}/dz-review", "--help"
  end
end
