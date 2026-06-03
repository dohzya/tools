class Md < Formula
  desc "Markdown surgeon - powerful markdown file manipulation tool"
  homepage "https://github.com/dohzya/tools"
  version "0.8.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/md-v0.8.0/md-darwin-arm64"
      sha256 "8d9411e35aaec6caaa2eaa88dc1bcbb95f9a42e56063a03d471a8c1f646f85a8"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/md-v0.8.0/md-darwin-x86_64"
      sha256 "4948425d7e7f70986b5340f6f6cd048c5cb9add806edb96f41b814d4054b1b95"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/md-v0.8.0/md-linux-arm64"
      sha256 "e0f6e8aa9140dffb8df5b14f19d2c5add8a552dde2c2bf8ca19bba2f0aebe6f4"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/md-v0.8.0/md-linux-x86_64"
      sha256 "bdddb31424e5c6ef2a67259e6351f3621815883d5ad13affc1bb4d253c387ec7"
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
