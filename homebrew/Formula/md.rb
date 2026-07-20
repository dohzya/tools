class Md < Formula
  desc "Markdown surgeon - powerful markdown file manipulation tool"
  homepage "https://github.com/dohzya/tools"
  version "0.9.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/md-v0.9.0/md-darwin-arm64"
      sha256 "4ac1f3b054aa2d119751178e2a22ff4f0a666209a1d33f620b9a9ca7ba28c3b2"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/md-v0.9.0/md-darwin-x86_64"
      sha256 "349c362cd81e50aeb3cfaf1e202375f2eabdfe1b87b92d6e6b5c93758027363e"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/md-v0.9.0/md-linux-arm64"
      sha256 "c02d670eb0e5e28a0fb89674352a7c0bed55dbb5241c8e543d5d914bf5cb1c26"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/md-v0.9.0/md-linux-x86_64"
      sha256 "abc3dc03ee2f2e32064d9b71a8405763b4ce9a7e9eea37cc13ef0edd76da4bfd"
    end
  end

  def install
    # Determine which binary was downloaded based on platform
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "md-darwin-arm64"
      else
        "md-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "md-linux-arm64"
      else
        "md-linux-x86_64"
      end
    end

    bin.install binary_name => "md"
  end

  test do
    system "#{bin}/md", "--help"
  end
end
