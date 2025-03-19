#include <QApplication>
#include <QDebug>
#include <QFile>
#include <QTextStream>

int main(int argc, char *argv[]) {
    QApplication a(argc, argv);

    QFile stdinFile(":/stdin");
    if (!stdinFile.open(QIODevice::ReadOnly | QIODevice::Text)) {
        qDebug() << "Error: Could not open stdin for reading.";
        qDebug() << "Error String:" << stdinFile.errorString(); // Get detailed error
        return 1; // Exit with an error code
    }

    QTextStream stream(&stdinFile);
    QString line = stream.readLine();
    qDebug() << "Read from stdin:" << line;

    stdinFile.close();
    return 0; // Exit normally
}